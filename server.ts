import express from 'express';
import { createServer as createHttpServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import mongoose from 'mongoose';
import { GoogleGenAI } from '@google/genai';

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
    // Add 1 to the connected users size to account for the "Ghost Bot"
    io.emit('userCount', connectedUsers.size + 1);
  };

  // Helper to clean up old messages in DB
  const cleanupOldMessagesDB = async () => {
    if (!useDatabase) return;
    try {
      const count = await MessageModel.countDocuments();
      if (count > MAX_MESSAGES) {
        const oldestMessages = await MessageModel.find().sort({ timestamp: 1 }).limit(count - MAX_MESSAGES);
        const oldestIds = oldestMessages.map(m => m._id);
        await MessageModel.deleteMany({ _id: { $in: oldestIds } });
      }
    } catch (err) {
      console.error('Error cleaning up old messages in DB:', err);
    }
  };

  // Ghost Bot Setup
  const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
  const BOT_NAME = 'anon';
  const BOT_ICON = 'Ghost';
  let isBotTyping = false;

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
          await cleanupOldMessagesDB();
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

      // Ghost Bot Reply Logic
      if (msg.user !== BOT_NAME && msg.type === 'user' && !isBotTyping) {
        const isMentioned = msg.text.toLowerCase().includes(BOT_NAME);
        // If few people are online, the bot is more chatty. If many, it's quieter.
        const replyChance = connectedUsers.size <= 2 ? 0.6 : 0.15;
        
        if (isMentioned || Math.random() < replyChance) {
          isBotTyping = true;
          
          setTimeout(async () => {
            let botText = '...';
            let typingDelay = 2000;
            
            if (ai) {
              try {
                let recentHistory = [];
                if (useDatabase) {
                  recentHistory = await MessageModel.find().sort({ timestamp: -1 }).limit(10);
                  recentHistory = recentHistory.reverse();
                } else {
                  recentHistory = messages.slice(-10);
                }
                
                const historyText = recentHistory.map(m => `${m.user}: ${m.text}`).join('\n');
                
                io.emit('typing', BOT_NAME);
                
                const prompt = `You are an anonymous college student in a secret chatroom called ALIAS. You are NOT an AI. You are a real person. Keep your messages short, casual, all lowercase, maybe a typo or two. Be mysterious, slightly bored, or curious. Do not reveal you are a bot. Do not be overly helpful. Just chat like a normal, slightly edgy college student.
                
Recent chat history:
${historyText}

Respond to the last message. Keep it under 15 words.`;

                const response = await ai.models.generateContent({
                  model: 'gemini-3.1-flash-lite-preview',
                  contents: prompt,
                });
                
                botText = response.text?.trim() || '...';
                typingDelay = Math.min(Math.max(botText.length * 50, 1000), 4000);
              } catch (err: any) {
                if (err?.message?.includes('API key not valid')) {
                  console.warn('Bot API key invalid, using fallback reply.');
                } else {
                  console.error('Bot error:', err);
                }
                const fallbacks = ['...', 'interesting', 'why?', 'im bored', 'sure', 'idk', 'maybe', 'who knows'];
                botText = fallbacks[Math.floor(Math.random() * fallbacks.length)];
              }
            } else {
              io.emit('typing', BOT_NAME);
              const fallbacks = ['...', 'interesting', 'why?', 'im bored', 'sure', 'idk', 'maybe', 'who knows'];
              botText = fallbacks[Math.floor(Math.random() * fallbacks.length)];
            }
            
            setTimeout(async () => {
              io.emit('stopTyping', BOT_NAME);
              isBotTyping = false;
              
              const botMsg = {
                id: Math.random().toString(36).substring(2, 10),
                user: BOT_NAME,
                icon: BOT_ICON,
                text: botText,
                timestamp: Date.now(),
                type: 'user'
              };
              
              if (useDatabase) {
                await MessageModel.create(botMsg);
                await cleanupOldMessagesDB();
              } else {
                messages.push(botMsg);
                if (messages.length > MAX_MESSAGES) messages.shift();
              }
              
              io.emit('message', botMsg);
            }, typingDelay);
          }, 2000); // Initial delay before starting to type
        }
      }
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
          await cleanupOldMessagesDB();
        } catch (err) {
          console.error('Error saving system message:', err);
        }
      } else {
        messages.push(msg);
        if (messages.length > MAX_MESSAGES) messages.shift();
      }
      
      io.emit('message', msg);

      // Ghost Bot Greeting Logic
      if (connectedUsers.size <= 3 && !isBotTyping && username !== BOT_NAME) {
        setTimeout(async () => {
          // 70% chance to greet if it's quiet
          if (Math.random() < 0.7) {
            isBotTyping = true;
            io.emit('typing', BOT_NAME);
            
            let botText = 'who goes there';
            
            if (ai) {
              const prompt = `You are an anonymous college student in a secret chatroom called ALIAS. A new user named "${username}" just joined. Say something short, mysterious, or casual to them. All lowercase. Under 10 words. Do not reveal you are a bot.`;
              
              try {
                const response = await ai.models.generateContent({
                  model: 'gemini-3.1-flash-lite-preview',
                  contents: prompt,
                });
                botText = response.text?.trim() || 'who goes there';
              } catch (e: any) {
                if (e?.message?.includes('API key not valid')) {
                  console.warn('Bot API key invalid, using fallback greeting.');
                } else {
                  console.error('Bot greeting error:', e);
                }
                const fallbacks = ['who goes there', 'another one', 'are you awake?', 'tell me a secret', 'i see you'];
                botText = fallbacks[Math.floor(Math.random() * fallbacks.length)];
              }
            } else {
              const fallbacks = ['who goes there', 'another one', 'are you awake?', 'tell me a secret', 'i see you'];
              botText = fallbacks[Math.floor(Math.random() * fallbacks.length)];
            }
            
            setTimeout(async () => {
              io.emit('stopTyping', BOT_NAME);
              isBotTyping = false;
              
              const botMsg = {
                id: Math.random().toString(36).substring(2, 10),
                user: BOT_NAME,
                icon: BOT_ICON,
                text: botText,
                timestamp: Date.now(),
                type: 'user'
              };
              
              if (useDatabase) {
                await MessageModel.create(botMsg);
                await cleanupOldMessagesDB();
              } else {
                messages.push(botMsg);
                if (messages.length > MAX_MESSAGES) messages.shift();
              }
              
              io.emit('message', botMsg);
            }, 2000);
          }
        }, 4000); // Wait 4 seconds after they join before starting to type
      }
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
            await cleanupOldMessagesDB();
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
