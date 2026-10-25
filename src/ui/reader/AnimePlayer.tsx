import { useEffect, useMemo, useRef, useState } from "react";
import type Hls from "hls.js";
import { SkipForward } from "@phosphor-icons/react";
import { proxyBase, proxyToken, request } from "@/core/http";
import { saveProgress } from "@/core/repo";
import type { ChapterRow, MangaRow, Source, StreamSet, StreamSource, SubtitleTrack } from "@/core/types";

/** SubRip to WebVTT: the browser only understands the second. */
export const srtToVtt = (srt: string) => `WEBVTT\n\n${srt.replace(/\r/g, "").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2").trim()}\n`;

async function loadSubtitle(track: SubtitleTrack, direct: boolean): Promise<string> {
  const text = direct ? await (await fetch(track.url, { credentials: "omit" })).text() : await (await request(track.url, { minGapMs: 0, retries: 1 })).text();
  const vtt = track.format === "srt" || !/^﻿?WEBVTT/.test(text) ? srtToVtt(text) : text;
  return URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
}

/** The video, its quality and subtitle choices, skip buttons, resume position and progress saving. */
export function AnimePlayer({ source, manga, chapter, onEnded, autoNext }: { source: Source; manga: MangaRow; chapter: ChapterRow; onEnded: () => void; autoNext: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const hls = useRef<Hls | null>(null);
  const [set, setSet] = useState<StreamSet | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [pick, setPick] = useState(0);
  const [tracks, setTracks] = useState<{ track: SubtitleTrack; src: string }[]>([]);
  const [time, setTime] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const savedAt = useRef(0);
  const stream: StreamSource | undefined = set?.streams[pick];

  // Ask the connector where this episode plays.
  useEffect(() => {
    let dead = false;
    setSet(null); setError(""); setPick(0); setCountdown(null);
    source.getStreams!({ url: chapter.url, name: chapter.name, dateUpload: chapter.dateUpload, number: chapter.number, season: chapter.season }, { url: manga.url, title: manga.title })
      .then((result) => { if (!dead) setSet(result); })
      .catch((cause: Error) => { if (!dead) setError(cause.message); });
    return () => { dead = true; };
  }, [chapter.id, attempt]);

  // Subtitles are fetched through the connector's own route, converted, and handed to the video as local files.
  useEffect(() => {
    if (!set?.subtitles.length) { setTracks([]); return; }
    let dead = false;
    const made: string[] = [];
    void Promise.all(set.subtitles.map(async (track) => { try { const src = await loadSubtitle(track, !!source.directImages); made.push(src); return { track, src }; } catch { return null; } }))
      .then((list) => { if (!dead) setTracks(list.filter((x): x is { track: SubtitleTrack; src: string } => !!x)); });
    return () => { dead = true; made.forEach((src) => URL.revokeObjectURL(src)); };
  }, [set]);

  // Attach the chosen stream. HLS goes through hls.js unless the browser plays it natively.
  useEffect(() => {
    const el = video.current;
    if (!el || !stream) return;
    let dead = false;
    hls.current?.destroy(); hls.current = null;
    const resume = () => { if (chapter.lastPage > 5 && !chapter.read && (!el.duration || chapter.lastPage < el.duration - 15)) el.currentTime = chapter.lastPage; };
    el.addEventListener("loadedmetadata", resume, { once: true });
    if (stream.type !== "hls") { el.src = stream.url; return () => { el.removeEventListener("loadedmetadata", resume); }; }
    void (async () => {
      const { default: Hls } = await import("hls.js");
      if (dead) return;
      if (!Hls.isSupported()) { el.src = stream.url; return; }
      const token = stream.proxy ? await proxyToken() : "";
      const player = new Hls({
        xhrSetup: stream.proxy ? (xhr, url) => {
          const qs = new URLSearchParams({ url });
          xhr.open("GET", `${proxyBase()}/fetch?${qs}`, true);
          if (stream.headers) xhr.setRequestHeader("x-comik-headers", JSON.stringify(stream.headers));
          if (token) xhr.setRequestHeader("authorization", `Bearer ${token}`);
        } : undefined,
      });
      hls.current = player;
      player.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) setError(`The video could not be loaded (${data.details}).`); });
      player.loadSource(stream.url);
      player.attachMedia(el);
    })();
    return () => { dead = true; el.removeEventListener("loadedmetadata", resume); hls.current?.destroy(); hls.current = null; };
  }, [stream?.url, stream?.proxy]);

  // Save the position every few seconds, and when the episode counts as watched.
  const save = (finished = false) => {
    const el = video.current;
    if (!el || !el.duration || !Number.isFinite(el.duration)) return;
    void saveProgress(chapter.id, Math.floor(el.currentTime), Math.floor(el.duration), finished || el.currentTime / el.duration > 0.9);
  };
  useEffect(() => () => save(), [chapter.id]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) { onEnded(); return; }
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const skip = useMemo(() => set?.skips.find((range) => time >= range.start && time < range.end), [set, Math.floor(time)]);

  if (error) return <div className="player-error"><p>{error}</p><button className="btn primary" onClick={() => { setError(""); setAttempt((n) => n + 1); }}>Try again</button></div>;
  if (!set) return <div className="player-loading"><span className="reader-spinner" /><span>Finding the video</span></div>;
  return (
    <div className="player">
      <div className="player-frame">
        <video ref={video} controls playsInline preload="metadata" poster={chapter.thumbnail || undefined}
          onTimeUpdate={(event) => { const t = event.currentTarget.currentTime; setTime(t); if (t - savedAt.current > 5 || t < savedAt.current) { savedAt.current = t; save(); } }}
          onPause={() => save()}
          onEnded={() => { save(true); if (autoNext) setCountdown(5); }}>
          {tracks.map(({ track, src }) => <track key={src} kind="subtitles" src={src} srcLang={track.lang} label={track.label} default={track.default} />)}
        </video>
        {skip && <button className="player-skip" onClick={() => { if (video.current) video.current.currentTime = skip.end; }}><SkipForward size={16} weight="fill" /> Skip {skip.kind}</button>}
        {countdown !== null && <div className="player-next"><span>Next episode in {countdown}</span><button className="btn sm" onClick={() => setCountdown(null)}>Cancel</button><button className="btn sm primary" onClick={onEnded}>Play now</button></div>}
      </div>
      {set.streams.length > 1 && (
        <label className="player-quality"><span className="muted">Quality</span>
          <select className="input" value={pick} onChange={(event) => { const t = video.current?.currentTime ?? 0; setPick(Number(event.target.value)); if (t > 1) video.current?.addEventListener("loadedmetadata", () => { if (video.current) video.current.currentTime = t; }, { once: true }); }}>
            {set.streams.map((item, index) => <option key={item.url} value={index}>{item.label || `Stream ${index + 1}`}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
