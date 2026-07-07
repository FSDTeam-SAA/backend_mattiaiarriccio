/**
 * Realtime layer (Socket.IO) — attached to the same HTTP server as the REST API.
 *
 * The Flutter client (app_pigeon) already connects here, joins a room named by
 * its userId (via `joinNotification` / `joinNotificationRoom` / `joinChatRoom`),
 * and listens for `newNotification`. This server was previously missing, so the
 * socket connected to nothing and the app only updated via FCM / manual refresh.
 *
 * With this in place, anything that calls `emitToUser(userId, 'newNotification', …)`
 * updates the user's app in real time — no FCM required, no hot reload.
 *
 * Note: the client currently connects without a token, so rooms are keyed purely
 * by the userId the client emits. That mirrors the existing design; add a JWT
 * handshake check here if you later need to authorize socket connections.
 */

let io = null;

export const initSocket = async (httpServer) => {
  if (io) return io;

  const socketModule = await import('socket.io');
  const Server = socketModule.Server || socketModule.default?.Server || socketModule.default;

  io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    // The Flutter client uses the websocket transport; keep polling as a fallback.
    transports: ['websocket', 'polling']
  });

  io.on('connection', (socket) => {
    // The client emits its userId to join its personal room. All of these event
    // names are used by the app; treat them the same (room = userId).
    const join = (userId) => {
      const id = String(userId || '').trim();
      if (id) socket.join(id);
    };
    socket.on('join', join);
    socket.on('joinNotification', join);
    socket.on('joinNotificationRoom', join);
    socket.on('joinChatRoom', join);
  });

  return io;
};

export const getIo = () => io;

/**
 * Emit an event to every device of a user (their room). No-op (never throws) when
 * the socket server isn't initialized, so callers stay best-effort.
 */
export const emitToUser = (userId, event, payload) => {
  if (!io || !userId || !event) return false;
  try {
    io.to(String(userId)).emit(event, payload);
    return true;
  } catch (error) {
    console.error('[socket.service] emit failed:', error?.message || error);
    return false;
  }
};
