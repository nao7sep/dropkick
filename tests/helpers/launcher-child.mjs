// Disposable launcher protocol peer. This child owns only its loopback server;
// the parent chooses when it may accept closure and always reaps this process.
import { createServer } from "node:net";
const peers = new Set();
const server = createServer(socket => {
  peers.add(socket);
  let input = "";
  socket.on("data", chunk => {
    input += chunk;
    if (!input.endsWith("\n")) return;
    const request = JSON.parse(input.slice(8));
    if (request.secret !== "fixture-secret" || request.generation !== "fixture" || request.root !== "/fixture") {
      socket.end("refused\n"); return;
    }
    process.send({ requested: true });
    socket.write("pending\n");
  });
  socket.on("close", () => peers.delete(socket));
});
server.listen(0, "127.0.0.1", () => process.send({ port: server.address().port }));
process.on("message", message => {
  for (const socket of peers) socket.end(message === "accept" ? "accepted\n" : "cancelled\n");
  if (message === "accept") server.close(() => process.exit(0));
});
