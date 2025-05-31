import { createClient } from "redis";
import WebSocket, { WebSocketServer } from "ws";
import express from "express";
import cors from "cors";

const app = express();
app.use(
  cors({
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  })
);

const server = app.listen(8080, () => {
  console.log("WebSocket server running on port 8080");
});
const wss = new WebSocketServer({ server });

const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient.on("error", (err) => console.log("Redis Client Error", err));

const connectToRedis = async () => {
  try {
    await redisClient.connect();
    console.log("Connected to Redis Client!");
  } catch (error) {
    console.log("Error while connecting to Redis Client", error);
  }
};

connectToRedis();

app.get("/room/:roomId/messages", async (req, res) => {
  const { roomId } = req.params;
  if (!roomId) res.send("Could not find Room Id!!!");
  try {
    const rawMessages = await redisClient.lRange(`chat:${roomId}`, 0, -1);
    const messages = rawMessages.map((m) => JSON.parse(m));
    res.json({ messages });
  } catch (error) {
    console.error("Could not fetch messages", error);
  }
});


app.get("/room/:roomId/songs", async (req, res) => {
  const { roomId } = req.params;
  if (!roomId) res.send("Could not find Room Id!!!");
  try {
    const rawSongs = await redisClient.lRange(`songs:${roomId}`, 0, -1);
    const songs = rawSongs.map((song) => JSON.parse(song));
    res.json({ songs });
  } catch (error) {
    console.error("Could not fetch songs", error);
  }
});

const rooms = new Map<string, Set<WebSocket>>();

wss.on("connection", (ws) => {
  console.log("Connected to the Websocket server");
  ws.on("error", console.error);
  ws.on("message", async (message) => {
    const { type, roomId, messageData } = JSON.parse(message.toString());

    console.log("this is the room Id:", roomId);
    const clients = rooms.get(roomId) || new Set();

    switch (type) {
      case "join":
        if (!rooms.has(roomId)) {
          rooms.set(roomId, new Set());
        }
        rooms.get(roomId)?.add(ws);
        break;

      case "chat":
        await redisClient.rPush(`chat:${roomId}`, JSON.stringify(messageData));
        await redisClient.lTrim(`chat:${roomId}`, 0, 99);
        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: "chat", messageData }));
          }
        }
        break;

      case "addSong":
        await redisClient.lPush(`songs:${roomId}`, JSON.stringify(messageData));
        console.log("messageData:", messageData);
        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: "addSong", messageData }));
          }
        }
        break;
      
      case "likeSong":
        //Handle Upvoting the song
        break;
      
      case "unLikeSong":
        //Handle Unliking the song
        break;

      case "playNext":  
        console.log("The play pause type :", type);
        console.log("The song State", messageData);
        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: "playNext", messageData }));
          }
        }
    }
  });
  ws.on("close", () => {
    for (const [roomId, clients] of rooms.entries()) {
      clients.delete(ws);
      if (clients.size === 0) {
        rooms.delete(roomId);
      }
    }
  });
});
