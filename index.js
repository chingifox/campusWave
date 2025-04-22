const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Connect to MongoDB using mongoose
mongoose.connect(process.env.MONGO_URI, {
  dbName: process.env.DB_NAME,
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection;
db.on('error', (error) => console.error('❌ MongoDB connection error:', error));
db.once('open', () => console.log('✅ Connected to MongoDB'));

const storage = multer.memoryStorage();
const upload = multer({ storage });

// Routes

app.post('/createPost', upload.single('postImage'), async (req, res) => {
  try {
    const { postText, type, firebaseUID } = req.body;

    if (!postText || !type || !firebaseUID) {
      return res.status(400).json({ status: 'error', error: 'All fields are required' });
    }

    let imageUrl = '';

    if (req.file) {
      const base64Image = req.file.buffer.toString('base64');
      const imgbbResponse = await axios.post(
        `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`,
        new URLSearchParams({ image: base64Image }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );
      imageUrl = imgbbResponse.data.data.url;
    }

    if (type === 'Lost & Found' && !imageUrl) {
      return res.status(400).json({ status: 'error', error: 'Lost and found posts require an image' });
    }

    const post = {
      firebaseUID,
      text: postText,
      type,
      imageUrl,
      createdAt: new Date(),
    };

    const result = await db.collection('posts').insertOne(post);
    post._id = result.insertedId;

    res.status(201).json({ status: 'success', post });
  } catch (err) {
    console.error('❌ Error creating post:', err);
    res.status(500).json({ status: 'error', error: 'Failed to create post' });
  }
});

app.post('/createEvent', async (req, res) => {
  try {
    const { name, description, host, time, location, contactName, contactEmail, fee } = req.body;

    if (!name || !description || !host || !time || !location || !contactName || !contactEmail || !fee) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const event = {
      name,
      description,
      host,
      time,
      location,
      contactName,
      contactEmail,
      regfee: fee,
      isCompleted: false,
      createdAt: new Date(),
    };

    await db.collection('events').insertOne(event);
    res.status(201).json({ message: 'Event created successfully', event });
  } catch (err) {
    console.error('Error creating event:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/createDocument', async (req, res) => {
  try {
    const { name, type, url, firebaseUID } = req.body;

    if (!name || !type || !url || !firebaseUID) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const document = {
      name,
      url,
      type,
      firebaseUID,
      createdAt: new Date(),
    };

    await db.collection('documents').insertOne(document);
    res.status(201).json({ message: 'Document uploaded', document });
  } catch (err) {
    console.error('Error uploading document:', err);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

app.get('/events', async (req, res) => {
  try {
    const events = await db.collection('events')
      .find({ isCompleted: false }, { projection: { _id: 0, name: 1 } })
      .toArray();
    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

app.get('/eventDetails', async (req, res) => {
  const eventName = req.query.name;

  if (!eventName) {
    return res.status(400).json({ error: 'Missing event name in query' });
  }

  try {
    const event = await db.collection('events').findOne({ name: eventName }, { projection: { _id: 0 } });

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json({ event });
  } catch (err) {
    console.error('Error fetching event:', err);
    res.status(500).json({ error: 'Failed to fetch event details' });
  }
});

app.get('/posts', async (req, res) => {
  try {
    const rawPosts = await db.collection('posts').aggregate([
      { $match: { type: 'Homepage' } },
      {
        $lookup: {
          from: 'users',
          localField: 'firebaseUID',
          foreignField: 'firebaseUID',
          as: 'user',
        },
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          firebaseUID: 1,
          text: 1,
          createdAt: 1,
          type: 1,
          imageUrl: 1,
          name: { $ifNull: ['$user.name', 'Unknown'] },
          profileImage: { $ifNull: ['$user.profileImage', null] },
        },
      },
    ]).toArray();

    const formatted = rawPosts.map((post) => ({ posts: post }));
    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

app.get('/lostfound', async (req, res) => {
  try {
    const rawPosts = await db.collection('posts').aggregate([
      { $match: { type: 'Lost & Found' } },
      {
        $lookup: {
          from: 'users',
          localField: 'firebaseUID',
          foreignField: 'firebaseUID',
          as: 'user',
        },
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          uid: 1,
          text: 1,
          createdAt: 1,
          type: 1,
          imageUrl: 1,
          name: { $ifNull: ['$user.name', 'Unknown'] },
          profileImage: { $ifNull: ['$user.profileImage', null] },
        },
      },
    ]).toArray();

    const formatted = rawPosts.map((post) => ({ posts: post }));
    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

app.get('/profile', async (req, res) => {
  const { firebaseUID } = req.query;

  if (!firebaseUID) {
    return res.status(400).json({ error: 'firebaseUID is required' });
  }

  try {
    const user = await db.collection('users').findOne({ firebaseUID });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const posts = await db.collection('posts')
      .find({ firebaseUID: user.firebaseUID, type: 'Homepage' })
      .project({ _id: 0 })
      .toArray();

    res.json({
      user: {
        firebaseUID: user.firebaseUID,
        universityId: user.uid,
        name: user.name,
        role: user.role,
        department: user.department,
        profileImage: user.profileImage,
        email: user.email,
        club: user.club,
        joiningYear: user.joiningYear,
      },
      posts,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

app.get('/documents', async (req, res) => {
  try {
    const documents = await db.collection('documents').find().toArray();
    res.json({ document: documents });
  } catch (err) {
    console.error('Error fetching documents:', err);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
