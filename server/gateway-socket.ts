import type { Server } from "socket.io";
import { io as connectToGame } from "socket.io-client";

export function registerGatewaySockets(io: Server) {
  io.on("connection", (socket) => {
    const target = (process.env.GAME_SERVICE_URL_75 ?? "https://seven5bingoo.onrender.com").replace(/\/$/, "");
    if (!target) {
      socket.emit("game:error", { message: "GAME_SERVICE_URL_75 is not configured" });
      socket.disconnect(true);
      return;
    }

    const upstream = connectToGame(target, {
      transports: ["polling", "websocket"],
      upgrade: false,
      query: { gameType: "75" },
      auth: { initData: socket.handshake.auth?.initData },
    });
    upstream.on("game:state", (state) => socket.emit("game:state", state));
    upstream.on("game:error", (error) => socket.emit("game:error", error));
    upstream.on("cards:occupied", (cards) => socket.emit("cards:occupied", cards));
    upstream.on("game:announcement", (announcement) => socket.emit("game:announcement", announcement));
    upstream.on("connect_error", () => socket.emit("game:error", { message: "Game service unavailable" }));
    socket.on("game:join", (payload, acknowledge) => upstream.emit("game:join", payload, acknowledge));
    socket.on("game:selection", (payload, acknowledge) => upstream.emit("game:selection", payload, acknowledge));
    socket.on("game:leave", () => upstream.emit("game:leave"));
    socket.on("disconnect", () => upstream.disconnect());
  });
}
