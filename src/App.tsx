import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Send, LogOut, User, Headphones, Smile, UserCircle, UserSquare, Frown, Meh, Laugh, Angry, Annoyed, Ghost, Skull, Glasses, Heart, Bot, Cat, Dog, Star, Pencil, X, Trash2, Reply, Zap, Sparkles, VolumeX, Volume2, SmilePlus, ThumbsDown, Eraser } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'motion/react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Message {
  id: string;
  user: string;
  text: string;
  timestamp: number;
  type?: 'user' | 'system';
  isEdited?: boolean;
  likes?: string[];
  dislikes?: string[];
  reactions?: Record<string, string[]>;
  replyTo?: {
    id: string;
    user: string;
    text: string;
  };
  icon?: string;
}

const playNotificationSound = () => {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.1);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  } catch (e) {
    console.error('Audio play failed:', e);
  }
};

const formatMessageDate = (timestamp: number) => {
  const date = new Date(timestamp);
  const today = new Date();
  const isToday = date.getDate() === today.getDate() && 
                  date.getMonth() === today.getMonth() && 
                  date.getFullYear() === today.getFullYear();
  
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return timeStr;
  
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
};

const getUserColor = (username: string) => {
  const colors = [
    'bg-[#e68a00]', // Orange
    'bg-[#808080]', // Gray
    'bg-[#4d79ff]', // Blue
    'bg-[#00b33c]', // Green
    'bg-[#9933ff]', // Purple
  ];
  const hash = username.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
};

const getUserIcon = (iconName?: string, username?: string) => {
  const icons: Record<string, React.ElementType> = {
    User, Headphones, Smile, UserCircle, UserSquare, Frown, Meh, Laugh, Angry, Annoyed, Ghost, Skull, Glasses, Heart, Bot, Cat, Dog, Star
  };
  
  if (iconName && icons[iconName]) {
    const Icon = icons[iconName];
    return <Icon size={28} className="text-white" strokeWidth={1.5} />;
  }

  const iconList = Object.values(icons);
  const hash = (username || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const Icon = iconList[hash % iconList.length];
  return <Icon size={28} className="text-white" strokeWidth={1.5} />;
};

const AVAILABLE_ICONS = [
  'User', 'Headphones', 'Smile', 'UserCircle', 'UserSquare', 
  'Frown', 'Meh', 'Laugh', 'Angry', 'Annoyed', 
  'Ghost', 'Skull', 'Glasses', 'Heart', 'Bot'
];

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [selectedIcon, setSelectedIcon] = useState<string>('User');
  const [error, setError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [userCount, setUserCount] = useState<number>(0);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [replyingToMessage, setReplyingToMessage] = useState<Message | null>(null);
  const [messageToDelete, setMessageToDelete] = useState<string | null>(null);
  const [mutedUsers, setMutedUsers] = useState<string[]>([]);
  const [spamWarning, setSpamWarning] = useState<string | null>(null);
  const [activeReactionMessageId, setActiveReactionMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Connect to socket when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      // Connect to the same host that serves the app
      const newSocket = io(window.location.origin);
      
      newSocket.on('connect', () => {
        console.log('Connected to server');
        newSocket.emit('join', { username: username.trim(), icon: selectedIcon });
      });

      newSocket.on('init', (history: Message[]) => {
        setMessages(history);
      });

      newSocket.on('userCount', (count: number) => {
        setUserCount(count);
      });

      newSocket.on('message', (msg: Message) => {
        setMessages((prev) => [...prev, msg]);
        if (msg.user !== username.trim() && msg.type !== 'system') {
          playNotificationSound();
        }
      });

      newSocket.on('messageEdited', ({ id, newText }: { id: string, newText: string }) => {
        setMessages((prev) => prev.map(m => m.id === id ? { ...m, text: newText, isEdited: true } : m));
      });

      newSocket.on('messageDeleted', (id: string) => {
        setMessages((prev) => prev.filter(m => m.id !== id));
      });

      newSocket.on('messageLiked', ({ id, likes, dislikes }: { id: string, likes: string[], dislikes?: string[] }) => {
        setMessages((prev) => prev.map(m => m.id === id ? { ...m, likes, dislikes: dislikes || m.dislikes } : m));
      });

      newSocket.on('messageDisliked', ({ id, dislikes, likes }: { id: string, dislikes: string[], likes?: string[] }) => {
        setMessages((prev) => prev.map(m => m.id === id ? { ...m, dislikes, likes: likes || m.likes } : m));
      });

      newSocket.on('messageReacted', ({ id, reactions }: { id: string, reactions: Record<string, string[]> }) => {
        setMessages((prev) => prev.map(m => m.id === id ? { ...m, reactions } : m));
      });

      newSocket.on('spamWarning', (warningMsg: string) => {
        setSpamWarning(warningMsg);
        setTimeout(() => setSpamWarning(null), 3000);
      });

      newSocket.on('typing', (user: string) => {
        setTypingUsers((prev) => {
          if (!prev.includes(user)) return [...prev, user];
          return prev;
        });
      });

      newSocket.on('stopTyping', (user: string) => {
        setTypingUsers((prev) => prev.filter((u) => u !== user));
      });

      setSocket(newSocket);

      return () => {
        newSocket.disconnect();
      };
    }
  }, [isAuthenticated]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setError('');

    // Simulate a network request for validation
    await new Promise(resolve => setTimeout(resolve, 1500));

    if (password.toLowerCase() !== 'cutmyfeet') {
      setError('Incorrect password.');
      setIsLoggingIn(false);
      return;
    }
    if (!username.trim()) {
      setError('Screen name is required.');
      setIsLoggingIn(false);
      return;
    }
    
    setIsAuthenticated(true);
    setIsLoggingIn(false);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || !socket) return;

    if (editingMessageId) {
      socket.emit('editMessage', {
        id: editingMessageId,
        newText: inputValue.trim()
      });
      setEditingMessageId(null);
    } else {
      socket.emit('message', {
        user: username.trim(),
        text: inputValue.trim(),
        replyTo: replyingToMessage ? {
          id: replyingToMessage.id,
          user: replyingToMessage.user,
          text: replyingToMessage.text
        } : undefined
      });
      setReplyingToMessage(null);
    }
    
    setInputValue('');
    
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    socket.emit('stopTyping', username.trim());
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    
    if (socket && username) {
      socket.emit('typing', username.trim());
      
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit('stopTyping', username.trim());
      }, 2000);
    }
  };

  const handleEditClick = (msg: Message) => {
    setEditingMessageId(msg.id);
    setReplyingToMessage(null);
    setInputValue(msg.text);
  };

  const handleReplyClick = (msg: Message) => {
    setReplyingToMessage(msg);
    setEditingMessageId(null);
  };

  const cancelEdit = () => {
    setEditingMessageId(null);
    setInputValue('');
  };

  const cancelReply = () => {
    setReplyingToMessage(null);
  };

  const getUserBadge = (targetUser: string) => {
    let msgCount = 0;
    let interactionsReceived = 0;
    messages.forEach(m => {
      if (m.user === targetUser && m.type !== 'system') {
        msgCount++;
        if (m.likes) interactionsReceived += m.likes.length;
        if (m.reactions) {
          Object.values(m.reactions).forEach((users: string[]) => {
            interactionsReceived += users.length;
          });
        }
      }
    });

    if (interactionsReceived >= 3) {
      return <Sparkles size={12} className="text-white/80" title="Highly Resonated" />;
    }
    if (msgCount >= 5) {
      return <Zap size={12} className="text-white/60" title="Active Contributor" />;
    }
    return null;
  };

  const toggleMute = (targetUser: string) => {
    setMutedUsers(prev => 
      prev.includes(targetUser) 
        ? prev.filter(u => u !== targetUser)
        : [...prev, targetUser]
    );
  };

  const handleClearChat = () => {
    setMessages([]);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setPassword('');
    setUsername('');
    setMessages([]);
    if (socket) {
      socket.disconnect();
      setSocket(null);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-black text-gray-300 font-sans flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center flex flex-col items-center">
            <div className="flex items-center justify-center gap-4 mb-3">
              <motion.div 
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 20, delay: 0.2 }}
                className="w-8 h-8 bg-white rounded-full"
              ></motion.div>
              <motion.h1 
                initial={{ opacity: 0, letterSpacing: "0em", filter: "blur(4px)" }}
                animate={{ opacity: 1, letterSpacing: "0.25em", filter: "blur(0px)" }}
                transition={{ duration: 1.2, ease: "easeOut", delay: 0.4 }}
                className="text-4xl font-light text-white uppercase ml-[0.25em]"
              >
                ALIAS
              </motion.h1>
            </div>
            <motion.p 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 1.4 }}
              className="text-xs text-gray-700 mt-4 italic"
            >
              Created by Sebastian
            </motion.p>
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 1.5 }}
            className="mt-8"
          >
            <label className="block text-xs uppercase tracking-widest mb-3 text-gray-500 text-center">Select Avatar</label>
            <div className="grid grid-cols-5 gap-2 max-w-[250px] mx-auto">
              {AVAILABLE_ICONS.map((iconName) => {
                const isSelected = selectedIcon === iconName;
                return (
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    key={iconName}
                    type="button"
                    onClick={() => setSelectedIcon(iconName)}
                    className={cn(
                      "w-10 h-10 flex items-center justify-center border transition-all",
                      isSelected 
                        ? "border-green-500 bg-green-500/20 text-green-400" 
                        : "border-gray-800 bg-gray-900 text-gray-500 hover:border-gray-600 hover:text-gray-300"
                    )}
                  >
                    {getUserIcon(iconName)}
                  </motion.button>
                );
              })}
            </div>
          </motion.div>

          <motion.form 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 1.6 }}
            onSubmit={handleLogin} 
            className="space-y-6 mt-8"
          >
            <div>
              <label className="block text-xs uppercase tracking-widest mb-2 text-gray-500">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoggingIn}
                className="w-full bg-transparent border-b border-gray-700 focus:border-white outline-none py-2 text-white transition-colors disabled:opacity-50"
                placeholder="Enter password..."
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs uppercase tracking-widest mb-2 text-gray-500">Screen Name</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoggingIn}
                className="w-full bg-transparent border-b border-gray-700 focus:border-white outline-none py-2 text-white transition-colors disabled:opacity-50"
                placeholder="Choose an alias..."
                maxLength={20}
              />
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={isLoggingIn}
              className="w-full border border-gray-700 hover:bg-white hover:text-black transition-colors py-3 uppercase tracking-widest text-sm font-bold mt-8 flex justify-center items-center disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-white"
            >
              {isLoggingIn ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  AUTHENTICATING...
                </span>
              ) : (
                'Enter'
              )}
            </motion.button>
          </motion.form>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] bg-black text-gray-300 font-sans flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex justify-between items-center p-4 border-b border-gray-900 bg-black shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-white rounded-full"></div>
          <h1 className="text-xl font-light text-white uppercase tracking-widest">ALIAS</h1>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-widest">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            {userCount} Online
          </div>
          <motion.button 
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            type="button"
            onClick={handleClearChat}
            className="text-gray-500 hover:text-white transition-colors flex items-center gap-2 text-sm uppercase tracking-widest mr-4"
            title="Clear Chat"
          >
            <span className="hidden sm:inline">Clear</span>
            <Eraser size={18} />
          </motion.button>
          <motion.button 
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            type="button"
            onClick={handleLogout}
            className="text-gray-500 hover:text-white transition-colors flex items-center gap-2 text-sm uppercase tracking-widest"
            title="Disconnect"
          >
            <span className="hidden sm:inline">Exit</span>
            <LogOut size={18} />
          </motion.button>
        </div>
      </header>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-600 text-sm italic">
            No messages yet. Be the first to speak.
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((msg, idx) => {
              if (msg.type === 'system') {
                return (
                  <motion.div 
                    key={msg.id || idx} 
                    layout
                    initial={{ opacity: 0, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, filter: 'blur(4px)' }}
                    className="flex justify-center my-4"
                  >
                    <span className="text-xs text-gray-500 italic bg-gray-900/50 px-4 py-1.5 rounded-full flex items-center gap-2">
                      {msg.text}
                      <span className="text-[10px] text-gray-600">
                        {formatMessageDate(msg.timestamp)}
                      </span>
                    </span>
                  </motion.div>
                );
              }

              const isOwnMessage = msg.user === username;
              const canEdit = isOwnMessage && (Date.now() - msg.timestamp < 15 * 60 * 1000);

              if (mutedUsers.includes(msg.user)) {
                return (
                  <motion.div 
                    key={msg.id || idx} 
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex justify-center my-2"
                  >
                    <span 
                      onClick={() => toggleMute(msg.user)}
                      className="text-[10px] text-gray-600 italic cursor-pointer hover:text-gray-400 transition-colors flex items-center gap-1"
                      title="Click to unmute"
                    >
                      <VolumeX size={10} /> Message from muted user ({msg.user})
                    </span>
                  </motion.div>
                );
              }

              return (
              <motion.div 
                key={msg.id || idx} 
                layout
                initial={{ opacity: 0, filter: 'blur(4px)', y: 10 }}
                animate={{ 
                  opacity: (editingMessageId && editingMessageId !== msg.id) || (replyingToMessage && replyingToMessage.id !== msg.id) ? 0.3 : 1, 
                  filter: (editingMessageId && editingMessageId !== msg.id) || (replyingToMessage && replyingToMessage.id !== msg.id) ? 'blur(2px)' : 'blur(0px)', 
                  y: 0 
                }}
                exit={{ opacity: 0, filter: 'blur(4px)', scale: 0.95 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                className="flex items-start gap-4 group w-full"
                drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={{ left: 0, right: 0.2 }}
              onDragEnd={(e, info) => {
                if (info.offset.x > 50) {
                  handleReplyClick(msg);
                }
              }}
            >
              {/* Avatar */}
              <div className="flex flex-col items-center w-16 shrink-0">
                <div className={cn("w-12 h-12 border-2 border-white flex items-center justify-center mb-1", getUserColor(msg.user))}>
                  {getUserIcon(msg.icon, msg.user)}
                </div>
                <div className="flex items-center gap-1 w-full justify-center">
                  <span className="text-white text-xs truncate text-center">{msg.user}</span>
                  {getUserBadge(msg.user)}
                </div>
              </div>

              {/* Message Bubble and Timestamp */}
              <div className="flex flex-col gap-1 max-w-[75%] mt-1">
                <div className="flex items-end gap-2">
                  <div className="relative">
                    {/* Tail */}
                    <div className={cn("absolute -left-2 top-3 w-4 h-4 border-t-2 border-l-2 border-white transform -rotate-45", getUserColor(msg.user))}></div>
                    
                    {/* Bubble */}
                    <div className={cn(
                      "relative z-10 px-4 py-2 border-2 rounded-xl text-white text-sm break-words transition-all duration-500", 
                      getUserColor(msg.user),
                      (msg.likes?.length || 0) + (msg.reactions ? (Object.values(msg.reactions) as string[][]).reduce((acc, curr) => acc + curr.length, 0) : 0) >= 2 ? "border-white shadow-[0_0_15px_rgba(255,255,255,0.4)] bg-white/10" : "border-white shadow-sm"
                    )}>
                      {msg.replyTo && (
                        <div className="mb-2 pl-2 border-l-2 border-white/50 text-xs text-white/70 bg-black/20 rounded-r p-1">
                          <div className="font-bold text-white/90">@{msg.replyTo.user}</div>
                          <div className="truncate">{msg.replyTo.text}</div>
                        </div>
                      )}
                      {msg.text}
                    </div>
                  </div>
                  {/* Timestamp & Actions */}
                  <div className="flex items-center gap-2 shrink-0 mb-1 relative">
                    <span className="text-[10px] text-gray-500">
                      {formatMessageDate(msg.timestamp)}
                      {msg.isEdited && <span className="ml-1 italic opacity-70">(edited)</span>}
                    </span>
                    <div className="flex items-center gap-2 ml-1">
                      <motion.button 
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => socket?.emit('toggleLike', { messageId: msg.id, user: username.trim() })}
                        className={cn("flex items-center gap-1 transition-colors", msg.likes?.includes(username) ? "text-white" : "text-gray-500 hover:text-white")}
                        title="Like message"
                      >
                        <Heart size={12} className={msg.likes?.includes(username) ? "fill-white" : ""} />
                        {(msg.likes?.length || 0) > 0 && <span className="text-[10px] font-medium">{msg.likes?.length}</span>}
                      </motion.button>
                      
                      <motion.button 
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => socket?.emit('toggleDislike', { messageId: msg.id, user: username.trim() })}
                        className={cn("flex items-center gap-1 transition-colors", msg.dislikes?.includes(username) ? "text-red-500" : "text-gray-500 hover:text-red-400")}
                        title="Dislike message"
                      >
                        <ThumbsDown size={12} className={msg.dislikes?.includes(username) ? "fill-current" : ""} />
                        {(msg.dislikes?.length || 0) > 0 && <span className="text-[10px] font-medium">{msg.dislikes?.length}</span>}
                      </motion.button>
                      
                      <div className="relative">
                        <motion.button 
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => setActiveReactionMessageId(activeReactionMessageId === msg.id ? null : msg.id)}
                          className="text-gray-500 hover:text-white transition-colors"
                          title="React"
                        >
                          <SmilePlus size={12} />
                        </motion.button>
                        
                        {activeReactionMessageId === msg.id && (
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-gray-900 border border-gray-700 rounded-full py-1 px-2 flex gap-1 z-50 shadow-xl">
                            {['👍', '❤️', '😂', '😲', '😢', '🔥'].map(emoji => (
                              <motion.button
                                whileHover={{ scale: 1.2 }}
                                whileTap={{ scale: 0.9 }}
                                key={emoji}
                                onClick={() => {
                                  socket?.emit('toggleReaction', { messageId: msg.id, user: username.trim(), emoji });
                                  setActiveReactionMessageId(null);
                                }}
                                className="transition-transform text-sm px-1"
                              >
                                {emoji}
                              </motion.button>
                            ))}
                          </div>
                        )}
                      </div>

                      <motion.button 
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => handleReplyClick(msg)}
                        className="text-gray-500 hover:text-white transition-colors"
                        title="Reply to message"
                      >
                        <Reply size={12} />
                      </motion.button>
                      {isOwnMessage ? (
                        <>
                          {canEdit && (
                            <motion.button 
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              onClick={() => handleEditClick(msg)}
                              className="text-gray-500 hover:text-white transition-colors"
                              title="Edit message (within 15 mins)"
                            >
                              <Pencil size={12} />
                            </motion.button>
                          )}
                          <motion.button 
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            onClick={() => setMessageToDelete(msg.id)}
                            className="text-gray-500 hover:text-red-400 transition-colors"
                            title="Delete message"
                          >
                            <Trash2 size={12} />
                          </motion.button>
                        </>
                      ) : (
                        <motion.button 
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => toggleMute(msg.user)}
                          className="text-gray-500 hover:text-red-400 transition-colors"
                          title={`Mute ${msg.user}`}
                        >
                          <VolumeX size={12} />
                        </motion.button>
                      )}
                    </div>
                  </div>
                </div>
                
                {/* Display Reactions */}
                {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1 ml-4">
                    {Object.entries(msg.reactions).map(([emoji, users]: [string, string[]]) => (
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        key={emoji}
                        onClick={() => socket?.emit('toggleReaction', { messageId: msg.id, user: username.trim(), emoji })}
                        className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded-full border flex items-center gap-1 transition-colors",
                          users.includes(username) 
                            ? "bg-white/20 border-white/40 text-white" 
                            : "bg-black/40 border-gray-700 text-gray-400 hover:border-gray-500"
                        )}
                        title={users.join(', ')}
                      >
                        <span>{emoji}</span>
                        <span className="font-medium">{users.length}</span>
                      </motion.button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
            );
          })}
          </AnimatePresence>
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Typing Indicator */}
      <AnimatePresence>
        {typingUsers.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-6 py-3 text-xs text-gray-500 uppercase tracking-widest bg-black border-t border-gray-900 flex items-center gap-2 overflow-hidden"
          >
            <span>Someone is typing</span>
            <motion.span 
              animate={{ opacity: [0.2, 1, 0.2] }} 
              transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
              className="w-2 h-2 bg-white inline-block"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input Area */}
      <footer className="p-4 bg-black border-t border-gray-900 relative">
        {spamWarning && (
          <div className="absolute -top-10 left-0 right-0 flex justify-center pointer-events-none">
            <div className="bg-red-500/90 text-white text-xs px-4 py-2 rounded-full shadow-lg">
              {spamWarning}
            </div>
          </div>
        )}
        {editingMessageId && (
          <div className="max-w-4xl mx-auto flex items-center justify-between mb-2 px-2">
            <span className="text-xs text-blue-400 flex items-center gap-1">
              <Pencil size={12} /> Editing message...
            </span>
            <button onClick={cancelEdit} className="text-xs text-gray-500 hover:text-white flex items-center gap-1">
              <X size={12} /> Cancel
            </button>
          </div>
        )}
        {replyingToMessage && (
          <div className="max-w-4xl mx-auto flex items-center justify-between mb-2 px-2">
            <span className="text-xs text-gray-400 flex items-center gap-1 truncate">
              <Reply size={12} /> Replying to <span className="text-white font-medium">@{replyingToMessage.user}</span>: <span className="truncate max-w-[200px] sm:max-w-md">{replyingToMessage.text}</span>
            </span>
            <button onClick={cancelReply} className="text-xs text-gray-500 hover:text-white flex items-center gap-1 shrink-0 ml-4">
              <X size={12} /> Cancel
            </button>
          </div>
        )}
        <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto flex gap-4 items-center">
          <input
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            className="flex-1 bg-transparent border-b border-gray-700 focus:border-white outline-none py-3 text-white transition-colors text-base"
            placeholder={editingMessageId ? "Edit your message..." : "Type a message..."}
            autoFocus
            maxLength={500}
          />
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            type="submit"
            disabled={!inputValue.trim()}
            className="text-gray-500 hover:text-white disabled:opacity-50 disabled:hover:text-gray-500 transition-colors px-2"
          >
            <Send size={24} />
          </motion.button>
        </form>
      </footer>

      {/* Delete Confirmation Modal */}
      {messageToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-gray-900 border border-gray-800 p-6 rounded-xl max-w-sm w-full"
          >
            <h3 className="text-white text-lg font-medium mb-2">Delete Message?</h3>
            <p className="text-gray-400 text-sm mb-6">This action cannot be undone. The message will be permanently removed for everyone.</p>
            <div className="flex justify-end gap-3">
              <motion.button 
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setMessageToDelete(null)}
                className="px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors"
              >
                Cancel
              </motion.button>
              <motion.button 
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  if (socket && messageToDelete) {
                    socket.emit('deleteMessage', messageToDelete);
                    setMessageToDelete(null);
                  }
                }}
                className="px-4 py-2 text-sm bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-colors"
              >
                Delete
              </motion.button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
