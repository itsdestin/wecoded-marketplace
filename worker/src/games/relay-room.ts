// Versus-game relay rooms (Connect 4 and Chess), hosted in this Worker.
//
// WHY THIS FILE EXISTS: these two rooms used to run on hosted PartyKit
// (youcoded-games.itsdestin.partykit.dev). That platform shut down on
// 2026-10-23 and deleted every project, so no match could start. They now live
// here as Durable Objects built with `partyserver` (the open-source library
// PartyKit's own migration guide points to). Behaviour is deliberately
// IDENTICAL to the old rooms: same message shapes, same close codes.
//
// WHY A RELAY AND NOT A REFEREE: the rules live in the app (chess.js is a
// renderer dependency), so legality is enforced on BOTH clients. This room just
// seats two players and passes every message to the other one.
//
// Rooms are in-memory only (no hibernation, no storage): a room code is a
// throwaway capability and the old platform's stored data is gone anyway, so
// there is nothing to migrate. If the DO restarts, clients reconnect and the
// app's own resync logic takes over, exactly as it did on PartyKit.
import { Server, type Connection, type ConnectionContext, type WSMessage } from "partyserver";

const MAX_PLAYERS = 2;

export class RelayRoom extends Server {
  // connectionId -> username
  private players = new Map<string, string>();

  onConnect(connection: Connection, ctx: ConnectionContext) {
    const username = new URL(ctx.request.url).searchParams.get("username");
    if (!username) {
      connection.close(4000, "Missing username");
      return;
    }

    // Reconnection: the same username already in the room replaces its own
    // stale connection instead of being counted as a second player.
    let isReconnect = false;
    for (const [connId, name] of this.players) {
      if (name === username && connId !== connection.id) {
        this.players.delete(connId);
        this.getConnection(connId)?.close(4001, "Superseded by reconnection");
        isReconnect = true;
        break;
      }
    }

    // Reject a third player (two different players already present).
    if (!isReconnect && this.players.size >= MAX_PLAYERS) {
      connection.send(JSON.stringify({ type: "room-full" }));
      connection.close(4002, "Room is full");
      return;
    }

    this.players.set(connection.id, username);

    // Tell the arriving player who is already here.
    for (const [connId, name] of this.players) {
      if (connId !== connection.id) {
        connection.send(JSON.stringify({ type: "player-joined", username: name }));
      }
    }

    // Tell everyone else, marking reconnections so a client can tell a socket
    // blip from a brand-new opponent (and therefore not reset the position).
    this.broadcast(
      JSON.stringify({ type: "player-joined", username, reconnect: isReconnect }),
      [connection.id],
    );
  }

  onMessage(sender: Connection, message: WSMessage) {
    if (typeof message !== "string") return;
    // A rejected third connection (room-full) is closed but could still race a
    // message in; only seated players may relay.
    if (!this.players.has(sender.id)) return;
    this.broadcast(message, [sender.id]);
  }

  onClose(connection: Connection) {
    this.leave(connection);
  }

  onError(connection: Connection) {
    this.leave(connection);
  }

  private leave(connection: Connection) {
    const username = this.players.get(connection.id);
    if (!username) return;
    this.players.delete(connection.id);
    this.broadcast(JSON.stringify({ type: "player-left", username }));
  }
}

// Two classes (not one) so each game gets its own Durable Object namespace and
// URL name: /parties/connectfour/<room> and /parties/chess/<room>.
export class ConnectFourRoom extends RelayRoom {}
export class ChessRoom extends RelayRoom {}
