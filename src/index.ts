import { createClient } from "redis";
import WebSocket, { WebSocketServer } from "ws";
import express from "express";
import cors from "cors";
import axios from "axios";

const app = express();
app.use(
  cors({
    origin: ["https://groovehouse.vercel.app", "http://localhost:3000"],
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

    switch (type) {
      case "join":
        if (!rooms.has(roomId)) {
          rooms.set(roomId, new Set());
        }
        rooms.get(roomId)!.add(ws);

        const joinClients = rooms.get(roomId)!;
        const users = joinClients.size;

        for (const client of joinClients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: "join", users }));
          }
        }
        break;

      case "exit":
        const members = rooms.get(roomId);
        if (members) {
          members.delete(ws);
        }
        if (members?.size === 0) {
          rooms.delete(roomId);
          axios
            .delete(`https://tunz.vercel.app/api/room/?roomId=${roomId}`)
            .then(() => {
              console.log("Room Deleted");
            });
        }
        const joinedClients = rooms.get(roomId)!;
        const usersCount = joinedClients.size;

        for (const client of joinedClients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: "join", usersCount }));
          }
        }

        break;

      case "chat":
        await redisClient.rPush(`chat:${roomId}`, JSON.stringify(messageData));
        await redisClient.lTrim(`chat:${roomId}`, 0, 99);
        const chatClients = rooms.get(roomId)!;
        for (const client of chatClients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: "chat", messageData }));
          }
        }
        break;

      case "addSong":
        await redisClient.lPush(`songs:${roomId}`, JSON.stringify(messageData));
        const songClients = rooms.get(roomId)!;
        for (const client of songClients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: "addSong", messageData }));
          }
        }
        break;

      case "playNext":
        const nextClients = rooms.get(roomId)!;
        for (const client of nextClients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: "playNext", messageData }));
          }
        }
        break;

      // TODO: Handle likeSong and unLikeSong
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
