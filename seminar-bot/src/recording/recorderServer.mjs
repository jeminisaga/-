// Localhost bridge between the orchestrator and the recorder extension.
//  - WebSocket (/ext): sends start/stop commands, receives status.
//  - HTTP POST /upload: receives the finished webm blob and writes it to disk.
// The same port must match the extension's ORCH_PORT.
import express from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer } from "ws";

export class RecorderServer {
  constructor(cfg, log) {
    this.cfg = cfg;
    this.log = log;
    this.extSocket = null;
    this.pendingUploads = new Map(); // meetingId -> resolve(savedPath)
    fs.mkdirSync(cfg.recording.outputDir, { recursive: true });
  }

  async start() {
    const app = express();
    app.post("/upload", express.raw({ type: "*/*", limit: "2gb" }), (req, res) => {
      const meetingId = String(req.query.meetingId || "unknown").replace(/[^a-z0-9_-]/gi, "_");
      const file = path.join(this.cfg.recording.outputDir, `${meetingId}.webm`);
      fs.writeFileSync(file, req.body);
      this.log.info(`recording saved (${req.body.length} bytes): ${file}`);
      res.json({ ok: true, bytes: req.body.length });
      const resolve = this.pendingUploads.get(meetingId);
      if (resolve) {
        this.pendingUploads.delete(meetingId);
        resolve(file);
      }
    });

    this.server = http.createServer(app);
    this.wss = new WebSocketServer({ server: this.server, path: "/ext" });
    this.wss.on("connection", (ws) => {
      this.extSocket = ws;
      this.log.info("recorder extension connected");
      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(String(data));
          if (msg.status) this.log.info(`recorder status: ${msg.status} ${msg.detail || ""}`);
        } catch {}
      });
      ws.on("close", () => {
        if (this.extSocket === ws) this.extSocket = null;
      });
    });

    await new Promise((r) => this.server.listen(this.cfg.orchestratorPort, "127.0.0.1", r));
    this.log.info(`recorder server on http://127.0.0.1:${this.cfg.orchestratorPort}`);
  }

  /** Wait until the recorder extension has connected (browser launched). */
  waitForExtension(timeoutMs = 30000) {
    if (this.extSocket) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("recorder extension never connected")), timeoutMs);
      this.wss.once("connection", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  startRecording(meetingId, tabTitle) {
    if (!this.extSocket) throw new Error("no recorder extension connected");
    this.extSocket.send(
      JSON.stringify({
        cmd: "start",
        meetingId,
        title: tabTitle,
        audio: this.cfg.recording.captureAudio,
      })
    );
  }

  /** Signal stop and resolve with the saved file path once the blob lands. */
  stopRecording(meetingId, timeoutMs = 60000) {
    const wait = new Promise((resolve) => this.pendingUploads.set(meetingId, resolve));
    if (this.extSocket) this.extSocket.send(JSON.stringify({ cmd: "stop" }));
    return Promise.race([
      wait,
      new Promise((_, reject) => setTimeout(() => reject(new Error("upload timed out")), timeoutMs)),
    ]);
  }

  async close() {
    try {
      this.wss?.close();
      this.server?.close();
    } catch {}
  }
}
