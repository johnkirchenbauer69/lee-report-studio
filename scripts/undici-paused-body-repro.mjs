import { createServer } from "node:net";

const body = Buffer.alloc(64 * 1024);
const server = createServer((socket) => {
  socket.once("data", () => {
    socket.write(
      `HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
    );
    socket.write(body);
    socket.end();
  });
});

server.listen(0, "127.0.0.1", async () => {
  const { port } = server.address();
  await fetch(`http://127.0.0.1:${port}`); // Intentionally leave body unread.
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  console.log("No parser assertion observed in this run.");
  server.close();
});
