// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const app = express();

// Initialize OpenAI client
console.log('🔑 OpenAI API Key:', process.env.OPENAI_API_KEY ? '✅ Loaded' : '❌ Missing');
const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
}) : null;

if (openai) {
  console.log('🤖 OpenAI client initialized successfully');
} else {
  console.log('⚠️ OpenAI client not initialized - API key missing');
}

// Configure CORS for Express routes  
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      "http://localhost:3000",
      "http://localhost:4000",
      "http://localhost:5000",
      "https://slack-clone-flame-five.vercel.app"
    ];
    
    // Allow any Vercel deployment for this project
    const vercelPattern = /^https:\/\/.*\.vercel\.app$/;
    
    if (allowedOrigins.includes(origin) || vercelPattern.test(origin)) {
      return callback(null, true);
    }
    
    console.log('CORS blocked origin:', origin);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Parse JSON bodies
app.use(express.json());

const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: function (origin, callback) {
      // Allow requests with no origin
      if (!origin) return callback(null, true);
      
      const allowedOrigins = [
        "http://localhost:3000",
        "http://localhost:4000",
        "http://localhost:5000", 
        "https://slack-clone-flame-five.vercel.app"
      ];
      
      // Allow any Vercel deployment
      const vercelPattern = /^https:\/\/.*\.vercel\.app$/;
      
      if (allowedOrigins.includes(origin) || vercelPattern.test(origin)) {
        return callback(null, true);
      }
      
      console.log('Socket.IO CORS blocked origin:', origin);
      return callback(new Error('Not allowed by CORS'));
    },
    methods: ["GET", "POST"],
    credentials: true
  }
});
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Serve uploads statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Multer setup
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// File upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  // Return full URL for cross-origin access
  const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.json({ fileUrl, originalName: req.file.originalname });
});

const onlineUsers = {};

// Recursively add a reply to the correct parent message by ID
function addReplyRecursively(messages, parentId, reply) {
  for (let msg of messages) {
    if (msg.id === parentId) {
      if (!Array.isArray(msg.replies)) msg.replies = [];
      msg.replies.push(reply);
      return true; // Found and added
    } else if (Array.isArray(msg.replies) && msg.replies.length > 0) {
      if (addReplyRecursively(msg.replies, parentId, reply)) return true;
    }
  }
  return false; // Not found
}





// Utility: Find workspace by ID
function findWorkspaceById(workspaces, workspaceId) {
  return workspaces.find(ws => ws.id === workspaceId);
}

// Utility: Find channel by ID in a workspace
function findChannelById(workspace, channelId) {
  return workspace.channels.find(ch => ch.id === channelId);
}

// Utility: Find message by ID in a channel (recursive)
function findMessageById(messages, messageId) {
    for (const msg of messages) {
        if (msg.id === messageId) return msg;
        if (msg.replies) {
            const found = findMessageById(msg.replies, messageId);
            if (found) return found;
        }
    }
    return null;
}

const addReplyToMessage = (messages, parentId, reply) => {
    for (const message of messages) {
        if (message.id === parentId) {
            if (!message.replies) {
                message.replies = [];
            }
            message.replies.push(reply);
            return true;
        }
        if (message.replies) {
            if (addReplyToMessage(message.replies, parentId, reply)) {
                return true;
            }
        }
    }
    return false;
};

const updateReplyInMessages = (messages, replyId, newText) => {
    for (const message of messages) {
        if (message.replies && message.replies.length > 0) {
            const reply = message.replies.find(r => r.id === replyId);
            if (reply) {
                reply.text = newText;
                reply.time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                return reply;
            }
            const foundReply = updateReplyInMessages(message.replies, replyId, newText);
            if (foundReply) return foundReply;
        }
    }
    return null;
};

const deleteReplyFromMessages = (messages, replyId) => {
    for (const message of messages) {
        if (message.replies) {
            const replyIndex = message.replies.findIndex(r => r.id === replyId);
            if (replyIndex !== -1) {
                const [deletedReply] = message.replies.splice(replyIndex, 1);
                return { parentId: message.id, deletedReplyId: deletedReply.id };
            }
            const result = deleteReplyFromMessages(message.replies, replyId);
            if (result) return result;
        }
    }
    return null;
};

const updateReactionInMessages = (messages, messageId, userId, emoji) => {
    for (const message of messages) {
        if (message.id === messageId) {
            if (!message.reactions) message.reactions = [];

            const existingReaction = message.reactions.find(r => r.users.includes(userId));
            const isTogglingOff = existingReaction && existingReaction.emoji === emoji;

            // Remove user's previous reaction, if any
            if (existingReaction) {
                existingReaction.users = existingReaction.users.filter(u => u !== userId);
            }

            // Add new reaction, unless they are toggling off the same emoji
            if (!isTogglingOff) {
                const targetReaction = message.reactions.find(r => r.emoji === emoji);
                if (targetReaction) {
                    targetReaction.users.push(userId);
                } else {
                    message.reactions.push({ emoji, users: [userId] });
                }
            }

            // Clean up any reaction groups that are now empty
            message.reactions = message.reactions.filter(r => r.users.length > 0);

            return message.reactions;
        }

        if (message.replies && message.replies.length > 0) {
            const reactions = updateReactionInMessages(message.replies, messageId, userId, emoji);
            if (reactions) return reactions;
        }
    }
    return null;
};

// AI Assistant Configuration
const AI_ASSISTANT = {
    id: 'ai-assistant-001',
    username: '🤖 AI Assistant',
    avatarColor: '#6366f1',
    userId: 'ai-assistant-001'
};

// AI Service Functions
class AIService {
    static async shouldRespond(message, channel, workspace) {
        if (!openai) return false;
        
        const text = message.text.toLowerCase();
        
        // Always respond to direct AI mentions
        const aiMentioned = text.includes('@ai') || text.includes('ai assistant') || text.includes('🤖');
        if (aiMentioned) return true;
        
        // Always respond to help requests
        const isHelp = text.includes('help') || text.includes('assist') || text.includes('support');
        if (isHelp) return true;
        
        // Respond to questions with high probability
        const questionWords = ['what', 'how', 'why', 'when', 'where', 'who', 'which', 'can you', 'could you', 'would you'];
        const hasQuestionWord = questionWords.some(word => text.startsWith(word) || text.includes(` ${word} `));
        const hasQuestionMark = text.includes('?');
        
        if (hasQuestionWord || hasQuestionMark) {
            return Math.random() > 0.2; // 80% chance for questions
        }
        
        // Welcome new users in empty channels
        const isEmpty = channel.messages.length <= 1;
        if (isEmpty) return true;
        
        // Respond to conversational starters occasionally
        const conversationalStarters = ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'thanks', 'thank you'];
        const isConversational = conversationalStarters.some(starter => 
            text.includes(starter) || text.startsWith(starter)
        );
        
        if (isConversational) {
            return Math.random() > 0.6; // 40% chance for greetings
        }
        
        return false;
    }

    static async generateResponse(message, channel, workspace, allMessages = []) {
        if (!openai) {
            console.log('❌ AI Response blocked: OpenAI client not available');
            return "I'm currently unavailable. Please check if the OpenAI API key is configured correctly.";
        }

        console.log('🤖 Generating AI response for:', message.text.substring(0, 50) + '...');
        
        try {
            // Build context from recent messages
            const recentMessages = allMessages.slice(-10).map(msg => 
                `${msg.sender}: ${msg.text}`
            ).join('\n');

            // Determine response type based on message content
            const messageText = message.text.toLowerCase();
            
            if (messageText.includes('help') || messageText.includes('how to')) {
                return await this.generateHelpResponse(message, channel, workspace);
            } else if (messageText.includes('sentiment') || messageText.includes('mood')) {
                return await this.analyzeSentiment(recentMessages);
            } else if (messageText.includes('summary') || messageText.includes('summarize')) {
                return await this.summarizeConversation(recentMessages);
            } else if (messageText.includes('topic') || messageText.includes('suggest')) {
                return await this.suggestTopics(channel, workspace);
            } else {
                return await this.generateContextualResponse(message, recentMessages, channel, workspace);
            }
        } catch (error) {
            console.error('❌ AI Response Error:', error.message);
            console.error('Full error:', error);
            
            // Return a helpful error message based on the error type
            if (error.code === 'insufficient_quota') {
                return "I've reached my usage limit for now. Please try again later or check your OpenAI account. 💳";
            } else if (error.code === 'invalid_api_key') {
                return "There's an issue with my API key configuration. Please check the OpenAI API key. 🔑";
            } else if (error.code === 'rate_limit_exceeded') {
                return "I'm being asked too many questions at once! Please wait a moment and try again. ⏰";
            } else {
                return `I'm having trouble thinking right now (${error.message}). Please try again in a moment! 🤔`;
            }
        }
    }

    static async generateHelpResponse(message, channel, workspace) {
        const helpPrompts = {
            general: `You are a helpful AI assistant for a Slack-like chat application. Provide helpful guidance about:
            - Creating workspaces and channels
            - Sending messages and using reactions
            - File uploads and sharing
            - Using @ mentions and replies
            - Organizing conversations
            
            Keep responses friendly, concise, and practical. Use emojis appropriately.`,
            
            specific: `The user asked: "${message.text}"
            Channel: ${channel.name}
            Workspace: ${workspace.name}
            
            Provide specific, actionable help for their question.`
        };

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: helpPrompts.general },
                { role: "user", content: helpPrompts.specific }
            ],
            max_tokens: 200,
            temperature: 0.7
        });

        return response.choices[0].message.content;
    }

    static async analyzeSentiment(recentMessages) {
        if (!recentMessages || recentMessages.length === 0) {
            return "I don't see any recent messages to analyze. The conversation seems quiet! 📊";
        }

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{
                role: "system",
                content: `Analyze the sentiment of this conversation and provide a brief, friendly summary. 
                Include overall mood, energy level, and any notable patterns. Keep it conversational and add relevant emojis.`
            }, {
                role: "user",
                content: `Recent conversation:\n${recentMessages}`
            }],
            max_tokens: 150,
            temperature: 0.6
        });

        return `📊 **Conversation Analysis:**\n${response.choices[0].message.content}`;
    }

    static async summarizeConversation(recentMessages) {
        if (!recentMessages || recentMessages.length === 0) {
            return "Nothing to summarize yet! Start a conversation and I'll help you recap it later. 📝";
        }

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{
                role: "system", 
                content: `Summarize this conversation in 2-3 sentences. Focus on key points, decisions, and action items. Be concise but informative.`
            }, {
                role: "user",
                content: `Conversation to summarize:\n${recentMessages}`
            }],
            max_tokens: 150,
            temperature: 0.5
        });

        return `📝 **Conversation Summary:**\n${response.choices[0].message.content}`;
    }

    static async suggestTopics(channel, workspace) {
        const suggestions = [
            `💡 **Topic Ideas for #${channel.name}:**`,
            "• Share updates on current projects",
            "• Discuss upcoming goals and deadlines", 
            "• Exchange helpful resources and tips",
            "• Plan team activities or meetings",
            "• Ask questions and get quick answers",
            "",
            "What would you like to talk about? I'm here to help facilitate! 🚀"
        ];

        return suggestions.join('\n');
    }

    static async generateContextualResponse(message, recentMessages, channel, workspace) {
        const systemPrompt = `You are a helpful AI assistant in a Slack-like chat application.
        
        Context:
        - Current channel: #${channel.name}
        - Workspace: ${workspace.name}
        - You should be friendly, helpful, and conversational
        - Keep responses concise (1-3 sentences usually)
        - Use emojis appropriately but don't overdo it
        - You can help with platform features, answer questions, or just chat
        - If you don't know something specific, be honest and suggest alternatives
        
        Recent conversation context:
        ${recentMessages}`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: message.text }
            ],
            max_tokens: 200,
            temperature: 0.8
        });

        return response.choices[0].message.content;
    }

    static async createAIMessage(text, channelId) {
        return {
            id: `ai_msg_${Date.now()}`,
            text: text,
            sender: AI_ASSISTANT.username,
            userId: AI_ASSISTANT.userId,
            avatarColor: AI_ASSISTANT.avatarColor,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            replies: [],
            reactions: [],
            isAI: true // Special flag to identify AI messages
        };
    }
}

(async () => {
  const lowdb = await import('lowdb');
  const { Low } = lowdb;
  const node = await import('lowdb/node');
  const { JSONFile } = node;
  const adapter = new JSONFile('db.json');
  const db = new Low(adapter, { workspaces: [] });
  await db.read();

  // MIGRATION: Move all channels from db.data.messages to a default workspace if workspaces not present
  if (!db.data.workspaces || db.data.workspaces.length === 0) {
    const oldMessages = db.data.messages || {};
    const defaultWorkspace = {
      id: uuidv4(),
      name: 'General Workspace',
      channels: Object.keys(oldMessages).map(channelName => ({
        id: uuidv4(),
        name: channelName,
        messages: oldMessages[channelName] || []
      }))
    };
    db.data.workspaces = [defaultWorkspace];
    delete db.data.messages;
    await db.write();
    console.log('Migrated old channels to default workspace.');
  }

  // Ensure all messages have proper structure
  const migrate = async () => {
    await db.read();
    
    const ensureMessageStructure = (msg) => {
      if (!msg.id) {
        msg.id = crypto.randomUUID();
      }
      if (!Array.isArray(msg.replies)) {
        msg.replies = [];
      }
      if (!Array.isArray(msg.reactions)) {
        msg.reactions = [];
      }
      // Recursively ensure structure for replies
      if (msg.replies && msg.replies.length > 0) {
        msg.replies.forEach(ensureMessageStructure);
      }
      return msg;
    };
    
    db.data.workspaces.forEach(workspace => {
      workspace.channels.forEach(channel => {
        if (channel.messages && Array.isArray(channel.messages)) {
          channel.messages = channel.messages.map(ensureMessageStructure);
        }
      });
    });
    await db.write();
  };
  await migrate();

  app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
  });

  io.on('connection', (socket) => {
    console.log('a user connected');

    (async () => {
      await db.read();
      socket.emit('init', { workspaces: db.data.workspaces });
    })();

    socket.on('user info', ({ username, avatarColor }) => {
      console.log('Received user info:', username, avatarColor);
      onlineUsers[socket.id] = { username, avatarColor };
      console.log('Broadcasting presence:', Object.values(onlineUsers));
      io.emit('user presence', Object.values(onlineUsers));
    });

    socket.on('join channel', async ({ workspaceId, channelId }) => {
        socket.join(channelId);
        console.log(`User joined channel: ${channelId}`);
    });

    socket.on('leave channel', (channel) => {
      socket.leave(channel);
      console.log(`User left channel: ${channel}`);
    });

    // Add message
    socket.on('chat message', async ({ workspaceId, channel, msg, username, avatarColor, userId, fileUrl, fileName, pendingId }) => {
      await db.read();
      const workspace = findWorkspaceById(db.data.workspaces, workspaceId);
      if (!workspace) return;
      const ch = findChannelById(workspace, channel);
      if (!ch) return;
      const id = crypto.randomUUID();
      const message = { 
        id, 
        text: msg, 
        sender: username, 
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 
        avatarColor, 
        senderId: userId,
        replies: [],
        reactions: []
      };
      if (fileUrl) message.fileUrl = fileUrl;
      if (fileName) message.fileName = fileName;
      if (!ch.messages) ch.messages = [];
      ch.messages.push(message);
      await db.write();
      io.to(channel).emit('chat message', { workspaceId, channelId: channel, msg: message });
      
      // AI Assistant Integration - Check if AI should respond
      try {
        // Don't let AI respond to itself
        if (userId !== AI_ASSISTANT.userId && await AIService.shouldRespond(message, ch, workspace)) {
          // Add a small delay to make AI responses feel more natural
          setTimeout(async () => {
            try {
              await db.read(); // Refresh data
              const currentWorkspace = findWorkspaceById(db.data.workspaces, workspaceId);
              const currentChannel = findChannelById(currentWorkspace, channel);
              
              const aiResponseText = await AIService.generateResponse(
                message, 
                currentChannel, 
                currentWorkspace, 
                currentChannel.messages || []
              );
              
              const aiMessage = await AIService.createAIMessage(aiResponseText, channel);
              currentChannel.messages.push(aiMessage);
              await db.write();
              
              io.to(channel).emit('chat message', { 
                workspaceId, 
                channelId: channel, 
                msg: aiMessage 
              });
            } catch (aiError) {
              console.error('AI Response Error:', aiError);
            }
          }, Math.random() * 2000 + 500); // Random delay between 0.5-2.5 seconds
        }
      } catch (error) {
        console.error('AI Check Error:', error);
      }
    });

    // Direct AI Request Handler
    socket.on('ai request', async ({ workspaceId, channelId, prompt, username, userId }) => {
      console.log('🎯 Direct AI request received:', { workspaceId, channelId, prompt: prompt.substring(0, 50) + '...', username });
      
      try {
        await db.read();
        const workspace = findWorkspaceById(db.data.workspaces, workspaceId);
        if (!workspace) {
          console.log('❌ Workspace not found:', workspaceId);
          return;
        }
        const channel = findChannelById(workspace, channelId);
        if (!channel) {
          console.log('❌ Channel not found:', channelId);
          return;
        }

        console.log('📝 Processing AI request in channel:', channel.name);

        // Create a mock user message for context (not stored)
        const mockMessage = {
          text: prompt,
          sender: username,
          userId: userId
        };

        // Generate AI response
        console.log('🤖 Calling AIService.generateResponse...');
        const aiResponseText = await AIService.generateResponse(
          mockMessage, 
          channel, 
          workspace, 
          channel.messages || []
        );
        
        console.log('✅ AI response generated:', aiResponseText.substring(0, 100) + '...');
        
        const aiMessage = await AIService.createAIMessage(aiResponseText, channelId);
        channel.messages.push(aiMessage);
        await db.write();
        
        console.log('📤 Sending AI response to channel');
        io.to(channelId).emit('chat message', { 
          workspaceId, 
          channelId, 
          msg: aiMessage 
        });
        
      } catch (error) {
        console.error('❌ Direct AI Request Error:', error.message);
        console.error('Full error details:', error);
        
        // Send error message
        try {
          const errorMessage = await AIService.createAIMessage(
            `I'm having trouble processing that request: ${error.message} Please try again! 🤔`, 
            channelId
          );
          
          io.to(channelId).emit('chat message', { 
            workspaceId, 
            channelId, 
            msg: errorMessage 
          });
        } catch (errorMsgError) {
          console.error('❌ Failed to send error message:', errorMsgError);
        }
      }
    });

    // Delete message
    socket.on('delete message', async ({ workspaceId, channel, messageId, userId, username }) => {
      await db.read();
      const workspace = findWorkspaceById(db.data.workspaces, workspaceId);
      if (!workspace) return;
      const ch = findChannelById(workspace, channel);
      if (!ch) return;
      const idx = ch.messages.findIndex(m => m.id === messageId && m.sender === username);
      if (idx > -1) {
        ch.messages.splice(idx, 1);
        await db.write();
        io.to(channel).emit('message deleted', { workspaceId, channelId: channel, messageId });
      }
    });

    // Edit message
    socket.on('edit message', async ({ workspaceId, channel, messageId, newText, userId, username }) => {
      await db.read();
      const workspace = findWorkspaceById(db.data.workspaces, workspaceId);
      if (!workspace) return;
      const ch = findChannelById(workspace, channel);
      if (!ch) return;
      const msg = findMessageById(ch.messages, messageId);
      if (msg && msg.sender === username) {
        msg.text = newText;
        msg.time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        await db.write();
        io.to(channel).emit('message updated', { workspaceId, channelId: channel, messageId, newText: msg.text, newTime: msg.time });
      }
    });

    socket.on('add reply', async ({ workspaceId, channelId, parentId, reply }) => {
        await db.read();
        const workspace = findWorkspaceById(db.data.workspaces, workspaceId);
        if (!workspace) return;
        const channel = findChannelById(workspace, channelId);
        if (!channel) return;

        const newReply = {
            id: crypto.randomUUID(),
            ...reply,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            replies: [],
            reactions: []
        };

        if (addReplyToMessage(channel.messages, parentId, newReply)) {
            await db.write();
            io.to(channelId).emit('reply added', { workspaceId, channelId, parentId, reply: newReply });
        }
    });

    socket.on('update reply', async ({ workspaceId, channelId, replyId, newText, username }) => {
        await db.read();
        const workspace = findWorkspaceById(db.data.workspaces, workspaceId);
        if (!workspace) return;
        const channel = findChannelById(workspace, channelId);
        
        // Find the reply and check if user has permission to edit
        const reply = findMessageById(channel.messages, replyId);
        if (!reply || reply.sender !== username) return;
        
        const updatedReply = updateReplyInMessages(channel.messages, replyId, newText);

        if (updatedReply) {
            await db.write();
            io.to(channelId).emit('reply updated', { workspaceId, channelId, replyId, newText, time: updatedReply.time });
        }
    });

    socket.on('delete reply', async ({ workspaceId, channelId, replyId, username }) => {
        await db.read();
        const workspace = findWorkspaceById(db.data.workspaces, workspaceId);
        if (!workspace) return;
        const channel = findChannelById(workspace, channelId);
        
        // Find the reply and check if user has permission to delete
        const reply = findMessageById(channel.messages, replyId);
        if (!reply || reply.sender !== username) return;
        
        const result = deleteReplyFromMessages(channel.messages, replyId);

        if (result) {
            await db.write();
            io.to(channelId).emit('reply deleted', { workspaceId, channelId, parentId: result.parentId, replyId: result.deletedReplyId });
        }
    });

    socket.on('update reaction', async ({ workspaceId, channelId, messageId, userId, emoji }) => {
        await db.read();
        const workspace = findWorkspaceById(db.data.workspaces, workspaceId);
        if (!workspace) return;
        const channel = findChannelById(workspace, channelId);
        if (!channel) return;

        const updatedReactions = updateReactionInMessages(channel.messages, messageId, userId, emoji);

        if (updatedReactions) {
            await db.write();
            io.to(channelId).emit('reaction updated', { workspaceId, channelId, messageId, reactions: updatedReactions });
        }
    });

    // Handler to send all workspaces to the client
    socket.on('get workspaces', async () => {
      await db.read();
      socket.emit('init', { workspaces: db.data.workspaces || [] });
    });

    // Create new workspace
    socket.on('create workspace', async ({ name, createdBy, userId }) => {
      await db.read();
      const newWorkspace = {
        id: crypto.randomUUID(),
        name: name.trim(),
        createdBy,
        createdAt: new Date().toISOString(),
        channels: [
          {
            id: crypto.randomUUID(),
            name: 'general',
            messages: []
          }
        ]
      };
      
      db.data.workspaces.push(newWorkspace);
      await db.write();
      
      // Broadcast to all clients
      io.emit('workspace created', { workspace: newWorkspace });
      console.log(`Workspace "${name}" created by ${createdBy}`);
    });

    // Create new channel
    socket.on('create channel', async ({ workspaceId, name, createdBy, userId }) => {
      await db.read();
      const workspace = findWorkspaceById(db.data.workspaces, workspaceId);
      if (!workspace) return;
      
      // Check if channel name already exists in this workspace
      const existingChannel = workspace.channels.find(ch => ch.name.toLowerCase() === name.toLowerCase());
      if (existingChannel) {
        socket.emit('error', { message: 'Channel with this name already exists' });
        return;
      }
      
      const newChannel = {
        id: crypto.randomUUID(),
        name: name.trim(),
        createdBy,
        createdAt: new Date().toISOString(),
        messages: []
      };
      
      workspace.channels.push(newChannel);
      await db.write();
      
      // Broadcast to all clients
      io.emit('channel created', { workspaceId, channel: newChannel });
      console.log(`Channel "${name}" created in workspace "${workspace.name}" by ${createdBy}`);
    });

    // Delete workspace
    socket.on('delete workspace', async ({ workspaceId, userId, username }) => {
      await db.read();
      const workspaceIndex = db.data.workspaces.findIndex(ws => ws.id === workspaceId);
      if (workspaceIndex === -1) return;
      
      // Prevent deletion of the last workspace
      if (db.data.workspaces.length <= 1) {
        socket.emit('error', { message: 'Cannot delete the last workspace' });
        return;
      }
      
      const workspace = db.data.workspaces[workspaceIndex];
      db.data.workspaces.splice(workspaceIndex, 1);
      await db.write();
      
      // Broadcast to all clients
      io.emit('workspace deleted', { workspaceId });
      console.log(`Workspace "${workspace.name}" deleted by ${username}`);
    });

    // Delete channel
    socket.on('delete channel', async ({ workspaceId, channelId, userId, username }) => {
      await db.read();
      const workspace = findWorkspaceById(db.data.workspaces, workspaceId);
      if (!workspace) return;
      
      // Prevent deletion of the last channel
      if (workspace.channels.length <= 1) {
        socket.emit('error', { message: 'Cannot delete the last channel in a workspace' });
        return;
      }
      
      const channelIndex = workspace.channels.findIndex(ch => ch.id === channelId);
      if (channelIndex === -1) return;
      
      const channel = workspace.channels[channelIndex];
      workspace.channels.splice(channelIndex, 1);
      await db.write();
      
      // Broadcast to all clients
      io.emit('channel deleted', { workspaceId, channelId });
      console.log(`Channel "${channel.name}" deleted from workspace "${workspace.name}" by ${username}`);
    });

    // Rename workspace
    socket.on('rename workspace', async ({ workspaceId, newName, userId, username }) => {
      await db.read();
      const workspace = findWorkspaceById(db.data.workspaces, workspaceId);
      if (!workspace) return;
      
      const trimmedName = newName.trim();
      if (!trimmedName) {
        socket.emit('error', { message: 'Workspace name cannot be empty' });
        return;
      }
      
      // Check if workspace name already exists
      const existingWorkspace = db.data.workspaces.find(ws => ws.id !== workspaceId && ws.name.toLowerCase() === trimmedName.toLowerCase());
      if (existingWorkspace) {
        socket.emit('error', { message: 'Workspace with this name already exists' });
        return;
      }
      
      const oldName = workspace.name;
      workspace.name = trimmedName;
      await db.write();
      
      // Broadcast to all clients
      io.emit('workspace renamed', { workspaceId, newName: trimmedName });
      console.log(`Workspace "${oldName}" renamed to "${trimmedName}" by ${username}`);
    });

    // Rename channel
    socket.on('rename channel', async ({ workspaceId, channelId, newName, userId, username }) => {
      await db.read();
      const workspace = findWorkspaceById(db.data.workspaces, workspaceId);
      if (!workspace) return;
      
      const channel = findChannelById(workspace, channelId);
      if (!channel) return;
      
      const trimmedName = newName.trim();
      if (!trimmedName) {
        socket.emit('error', { message: 'Channel name cannot be empty' });
        return;
      }
      
      // Check if channel name already exists in this workspace
      const existingChannel = workspace.channels.find(ch => ch.id !== channelId && ch.name.toLowerCase() === trimmedName.toLowerCase());
      if (existingChannel) {
        socket.emit('error', { message: 'Channel with this name already exists' });
        return;
      }
      
      const oldName = channel.name;
      channel.name = trimmedName;
      await db.write();
      
      // Broadcast to all clients
      io.emit('channel renamed', { workspaceId, channelId, newName: trimmedName });
      console.log(`Channel "${oldName}" renamed to "${trimmedName}" in workspace "${workspace.name}" by ${username}`);
    });

    socket.on('disconnect', () => {
      delete onlineUsers[socket.id];
      console.log('User disconnected, broadcasting presence:', Object.values(onlineUsers));
      io.emit('user presence', Object.values(onlineUsers));
      console.log('user disconnected');
    });
  });
})();

const PORT = process.env.PORT || 4000;
http.listen(PORT, () => {
  console.log(`listening on *:${PORT}`);
});