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
  icon: String,
  text: String,
  timestamp: { type: Number, index: true },
  type: { type: String, default: 'user' },
  isEdited: { type: Boolean, default: false },
  likes: { type: [String], default: [] },
  dislikes: { type: [String], default: [] },
  reactions: { type: Map, of: [String], default: {} },
  replyTo: {
    id: String,
    user: String,
    text: String
  }
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
      await MessageModel.createIndexes();
      console.log('Successfully connected to MongoDB');
      useDatabase = true;
    } catch (err) {
      console.error('Failed to connect to MongoDB. Falling back to in-memory storage.', err);
    }
  } else {
    console.log('No MongoDB connection string found. Using in-memory storage.');
  }

  // Server-side state for chat messages (Fallback if DB is not configured)
  const messages: { id: string; user: string; icon?: string; text: string; timestamp: number; type?: string; isEdited?: boolean; likes?: string[]; dislikes?: string[]; reactions?: Record<string, string[]>; replyTo?: { id: string; user: string; text: string } }[] = [];
  const MAX_MESSAGES = 200;

  const connectedUsers = new Map<string, { username: string; icon: string }>();
  const rateLimits = new Map<string, number[]>();

  const broadcastUserCount = () => {
    io.emit('userCount', connectedUsers.size);
  };

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Send existing message history to the newly connected client
    const sendHistory = async () => {
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
    };
    sendHistory();

    // Handle incoming messages
    socket.on('message', async (data) => {
      const now = Date.now();
      const userTimestamps = rateLimits.get(socket.id) || [];
      const recentTimestamps = userTimestamps.filter(t => now - t < 10000); // last 10 seconds
      
      if (recentTimestamps.length >= 5) {
        socket.emit('spamWarning', 'You are sending messages too fast. Please wait a moment.');
        return;
      }
      
      recentTimestamps.push(now);
      rateLimits.set(socket.id, recentTimestamps);

      const userInfo = connectedUsers.get(socket.id);
      const icon = userInfo?.icon || 'User';

      const msg = {
        id: Math.random().toString(36).substring(2, 10),
        user: data.user || 'Anonymous',
        icon: icon,
        text: data.text,
        timestamp: Date.now(),
        type: 'user',
        replyTo: data.replyTo
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

    // Handle liking messages
    socket.on('toggleLike', async ({ messageId, user }) => {
      if (!user) return;

      if (useDatabase) {
        try {
          const msg = await MessageModel.findOne({ id: messageId });
          if (msg) {
            const likes = msg.likes || [];
            const dislikes = msg.dislikes || [];
            const index = likes.indexOf(user);
            if (index === -1) {
              likes.push(user);
              // Remove from dislikes if liking
              const dislikeIndex = dislikes.indexOf(user);
              if (dislikeIndex !== -1) {
                dislikes.splice(dislikeIndex, 1);
              }
            } else {
              likes.splice(index, 1);
            }
            msg.likes = likes;
            msg.dislikes = dislikes;
            await msg.save();
            io.emit('messageLiked', { id: messageId, likes: msg.likes, dislikes: msg.dislikes });
          }
        } catch (err) {
          console.error('Error toggling like in DB:', err);
        }
      } else {
        const msg = messages.find(m => m.id === messageId);
        if (msg) {
          msg.likes = msg.likes || [];
          msg.dislikes = msg.dislikes || [];
          const index = msg.likes.indexOf(user);
          if (index === -1) {
            msg.likes.push(user);
            // Remove from dislikes if liking
            const dislikeIndex = msg.dislikes.indexOf(user);
            if (dislikeIndex !== -1) {
              msg.dislikes.splice(dislikeIndex, 1);
            }
          } else {
            msg.likes.splice(index, 1);
          }
          io.emit('messageLiked', { id: messageId, likes: msg.likes, dislikes: msg.dislikes });
        }
      }
    });

    // Handle disliking messages
    socket.on('toggleDislike', async ({ messageId, user }) => {
      if (!user) return;

      if (useDatabase) {
        try {
          const msg = await MessageModel.findOne({ id: messageId });
          if (msg) {
            const dislikes = msg.dislikes || [];
            const likes = msg.likes || [];
            const index = dislikes.indexOf(user);
            if (index === -1) {
              dislikes.push(user);
              // Remove from likes if disliking
              const likeIndex = likes.indexOf(user);
              if (likeIndex !== -1) {
                likes.splice(likeIndex, 1);
              }
            } else {
              dislikes.splice(index, 1);
            }
            msg.dislikes = dislikes;
            msg.likes = likes;
            await msg.save();
            io.emit('messageDisliked', { id: messageId, dislikes: msg.dislikes, likes: msg.likes });
          }
        } catch (err) {
          console.error('Error toggling dislike in DB:', err);
        }
      } else {
        const msg = messages.find(m => m.id === messageId);
        if (msg) {
          msg.dislikes = msg.dislikes || [];
          msg.likes = msg.likes || [];
          const index = msg.dislikes.indexOf(user);
          if (index === -1) {
            msg.dislikes.push(user);
            // Remove from likes if disliking
            const likeIndex = msg.likes.indexOf(user);
            if (likeIndex !== -1) {
              msg.likes.splice(likeIndex, 1);
            }
          } else {
            msg.dislikes.splice(index, 1);
          }
          io.emit('messageDisliked', { id: messageId, dislikes: msg.dislikes, likes: msg.likes });
        }
      }
    });

    // Handle reacting to messages
    socket.on('toggleReaction', async ({ messageId, user, emoji }) => {
      if (!user || !emoji) return;

      if (useDatabase) {
        try {
          const msg = await MessageModel.findOne({ id: messageId });
          if (msg) {
            const reactions = msg.reactions || new Map();
            const users = reactions.get(emoji) || [];
            const index = users.indexOf(user);
            
            if (index === -1) {
              users.push(user);
            } else {
              users.splice(index, 1);
            }
            
            if (users.length === 0) {
              reactions.delete(emoji);
            } else {
              reactions.set(emoji, users);
            }
            
            msg.reactions = reactions;
            await msg.save();
            
            // Convert Map to plain object for emission
            const reactionsObj = Object.fromEntries(reactions);
            io.emit('messageReacted', { id: messageId, reactions: reactionsObj });
          }
        } catch (err) {
          console.error('Error toggling reaction in DB:', err);
        }
      } else {
        const msg = messages.find(m => m.id === messageId);
        if (msg) {
          msg.reactions = msg.reactions || {};
          const users = msg.reactions[emoji] || [];
          const index = users.indexOf(user);
          
          if (index === -1) {
            users.push(user);
          } else {
            users.splice(index, 1);
          }
          
          if (users.length === 0) {
            delete msg.reactions[emoji];
          } else {
            msg.reactions[emoji] = users;
          }
          
          io.emit('messageReacted', { id: messageId, reactions: msg.reactions });
        }
      }
    });

    // Handle typing events
    socket.on('typing', (username) => {
      socket.broadcast.emit('typing', username);
    });

    socket.on('stopTyping', (username) => {
      socket.broadcast.emit('stopTyping', username);
    });

    socket.on('join', async (data) => {
      const username = typeof data === 'string' ? data : data.username;
      const icon = typeof data === 'string' ? 'User' : data.icon;
      
      connectedUsers.set(socket.id, { username, icon });
      broadcastUserCount();
      
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

    // Handle message edits
    socket.on('editMessage', async ({ id, newText }) => {
      const userInfo = connectedUsers.get(socket.id);
      if (!userInfo) return;
      const username = userInfo.username;

      const timeLimit = 15 * 60 * 1000; // 15 minutes
      const now = Date.now();

      if (useDatabase) {
        try {
          const msg = await MessageModel.findOne({ id });
          if (msg && msg.user === username && (now - msg.timestamp) < timeLimit) {
            msg.text = newText;
            msg.isEdited = true;
            await msg.save();
            io.emit('messageEdited', { id, newText });
          }
        } catch (err) {
          console.error('Error editing message in DB:', err);
        }
      } else {
        const msg = messages.find(m => m.id === id);
        if (msg && msg.user === username && (now - msg.timestamp) < timeLimit) {
          msg.text = newText;
          msg.isEdited = true;
          io.emit('messageEdited', { id, newText });
        }
      }
    });

    // Handle message deletions
    socket.on('deleteMessage', async (id) => {
      const userInfo = connectedUsers.get(socket.id);
      if (!userInfo) return;
      const username = userInfo.username;

      if (useDatabase) {
        try {
          const msg = await MessageModel.findOne({ id });
          if (msg && msg.user === username) {
            await MessageModel.deleteOne({ id });
            io.emit('messageDeleted', id);
          }
        } catch (err) {
          console.error('Error deleting message in DB:', err);
        }
      } else {
        const index = messages.findIndex(m => m.id === id);
        if (index !== -1 && messages[index].user === username) {
          messages.splice(index, 1);
          io.emit('messageDeleted', id);
        }
      }
    });

    socket.on('disconnect', async () => {
      console.log('User disconnected:', socket.id);
      rateLimits.delete(socket.id);
      const userInfo = connectedUsers.get(socket.id);
      if (userInfo) {
        const username = userInfo.username;
        connectedUsers.delete(socket.id);
        broadcastUserCount();
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
