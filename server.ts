import express from 'express';
import { createServer as createHttpServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import mongoose from 'mongoose';

// Define Mongoose Schema for Messages
const messageSchema = new mongoose.Schema({
  id: String,
  user: String,
  text: String,
  timestamp: Number,
  type: { type: String, default: 'user' }
});
const MessageModel = mongoose.model('Message', messageSchema);

async function startServer() {
  const app = express();
  const httpServer = createHttpServer(app);
  
  // Initialize Socket.io
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
    }
  });

  const PORT = parseInt(process.env.PORT || '3000', 10);

  // MongoDB Connection
  const mongoConnectionString = process.env.MONGODB_URI || process.env.AZURE_COSMOS_CONNECTION_STRING;
  let useDatabase = false;

  if (mongoConnectionString) {
    try {
      // Added a 5-second timeout so the server doesn't hang forever if blocked by a firewall
      await mongoose.connect(mongoConnectionString, { serverSelectionTimeoutMS: 5000 });
      console.log('Successfully connected to MongoDB');
      useDatabase = true;
    } catch (err) {
      console.error('Failed to connect to MongoDB. Falling back to in-memory storage.', err);
    }
  } else {
    console.log('No MongoDB connection string found. Using in-memory storage.');
  }

  // Server-side state for chat messages (Fallback if DB is not configured)
  const messages: { id: string; user: string; text: string; timestamp: number; type?: string }[] = [];
  const MAX_MESSAGES = 200;

  const connectedUsers = new Map<string, string>();

  io.on('connection', async (socket) => {
    console.log('User connected:', socket.id);

    // Send existing message history to the newly connected client
    if (useDatabase) {
      try {
        const history = await MessageModel.find().sort({ timestamp: -1 }).limit(MAX_MESSAGES);
        // Reverse to show oldest first in the UI
        socket.emit('init', history.reverse());
      } catch (err) {
        console.error('Error fetching history from DB:', err);
        socket.emit('init', []);
      }
    } else {
      socket.emit('init', messages);
    }

    // Handle incoming messages
    socket.on('message', async (data) => {
      const msg = {
        id: Math.random().toString(36).substring(2, 10),
        user: data.user || 'Anonymous',
        text: data.text,
        timestamp: Date.now(),
        type: 'user'
      };
      
      if (useDatabase) {
        try {
          await MessageModel.create(msg);
          
          // Optional: Cleanup old messages in DB if it gets too large
          const count = await MessageModel.countDocuments();
          if (count > MAX_MESSAGES) {
            const oldestMessages = await MessageModel.find().sort({ timestamp: 1 }).limit(count - MAX_MESSAGES);
            const oldestIds = oldestMessages.map(m => m._id);
            await MessageModel.deleteMany({ _id: { $in: oldestIds } });
          }
        } catch (err) {
          console.error('Error saving message to DB:', err);
        }
      } else {
        messages.push(msg);
        // Keep only the last MAX_MESSAGES
        if (messages.length > MAX_MESSAGES) {
          messages.shift();
        }
      }

      // Broadcast the message to all connected clients
      io.emit('message', msg);
    });

    // Handle typing events
    socket.on('typing', (username) => {
      socket.broadcast.emit('typing', username);
    });

    socket.on('stopTyping', (username) => {
      socket.broadcast.emit('stopTyping', username);
    });

    socket.on('join', async (username) => {
      connectedUsers.set(socket.id, username);
      
      const msg = {
        id: Math.random().toString(36).substring(2, 10),
        user: 'System',
        text: `${username} joined the chat`,
        timestamp: Date.now(),
        type: 'system'
      };
      
      if (useDatabase) {
        try {
          await MessageModel.create(msg);
          const count = await MessageModel.countDocuments();
          if (count > MAX_MESSAGES) {
            const oldestMessages = await MessageModel.find().sort({ timestamp: 1 }).limit(count - MAX_MESSAGES);
            const oldestIds = oldestMessages.map(m => m._id);
            await MessageModel.deleteMany({ _id: { $in: oldestIds } });
          }
        } catch (err) {
          console.error('Error saving system message:', err);
        }
      } else {
        messages.push(msg);
        if (messages.length > MAX_MESSAGES) messages.shift();
      }
      
      io.emit('message', msg);
    });

    socket.on('disconnect', async () => {
      console.log('User disconnected:', socket.id);
      const username = connectedUsers.get(socket.id);
      if (username) {
        connectedUsers.delete(socket.id);
        const msg = {
          id: Math.random().toString(36).substring(2, 10),
          user: 'System',
          text: `${username} left the chat`,
          timestamp: Date.now(),
          type: 'system'
        };
        
        if (useDatabase) {
          try {
            await MessageModel.create(msg);
            const count = await MessageModel.countDocuments();
            if (count > MAX_MESSAGES) {
              const oldestMessages = await MessageModel.find().sort({ timestamp: 1 }).limit(count - MAX_MESSAGES);
              const oldestIds = oldestMessages.map(m => m._id);
              await MessageModel.deleteMany({ _id: { $in: oldestIds } });
            }
          } catch (err) {
            console.error('Error saving system message:', err);
          }
        } else {
          messages.push(msg);
          if (messages.length > MAX_MESSAGES) messages.shift();
        }
        
        io.emit('message', msg);
      }
    });
  });

  // API routes FIRST
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
