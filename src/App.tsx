import { ChangeEvent, useCallback, useMemo, useRef, useState } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

type ResolutionOption = "original" | "1080" | "720" | "480";
type VideoFormat = "mp4" | "webm";

const CORE_BASE_URL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
const NOTION_MESSAGES = [
  "Notionに動画をアップロードしたい...ただ、お金は払いたくない...だったら、作ればいいじゃないか！",
  "Notion無料プランのファイルアップロードは公式ヘルプで5MB制限と案内されているため、",
  "パーソナルな知識管理に組み込みやすいサイズへ最適化しましょう。",
] as const;

function appendLog(entry: { level: "info" | "error"; message: string }) {
  const timestamp = new Date().toLocaleTimeString();
  const formatted = `[${timestamp}] ${entry.message}`;
  if (entry.level === "error") {
    console.error(formatted);
  } else {
    console.info(formatted);
  }
}

if (typeof window !== "undefined") {
  (window as typeof window & { appendLog?: typeof appendLog }).appendLog = appendLog;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 Bytes";
  }
  const units = ["Bytes", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function getScaleFilter(option: ResolutionOption) {
  switch (option) {
    case "1080":
      return "scale='min(1920,iw)':-2";
    case "720":
      return "scale='min(1280,iw)':-2";
    case "480":
      return "scale='min(854,iw)':-2";
    default:
      return "";
  }
}

function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [ffmpegReady, setFfmpegReady] = useState(false);
  const [preset, setPreset] = useState("veryfast");
  const [crf, setCrf] = useState(28);
  const [resolution, setResolution] = useState<ResolutionOption>("original");
  const [format, setFormat] = useState<VideoFormat>("mp4");
  const [progress, setProgress] = useState(0);

  const ffmpegRef = useRef<FFmpeg | null>(null);
  const ffmpegLoadPromise = useRef<Promise<void> | null>(null);
  const outputName = useMemo(() => {
    if (!selectedFile) return "";
    const base = selectedFile.name.replace(/\.[^.]+$/, "");
    return `${base}-compressed.${format}`;
  }, [selectedFile, format]);

  const ensureFfmpeg = useCallback(async () => {
    if (ffmpegReady && ffmpegRef.current) return ffmpegRef.current;

    if (!ffmpegRef.current) {
      ffmpegRef.current = new FFmpeg();
      ffmpegRef.current.on("log", ({ message }) => {
        appendLog({ level: "info", message });
      });
      ffmpegRef.current.on("progress", ({ progress: value }) => {
        if (Number.isFinite(value)) {
          setProgress(Math.min(100, Math.round(value * 100)));
        }
      });
    }

    if (!ffmpegLoadPromise.current) {
      const loader = async () => {
        appendLog({ level: "info", message: "FFmpeg コアを読み込み中です..." });
        const ffmpeg = ffmpegRef.current!;
        await ffmpeg.load({
          coreURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, "text/javascript"),
          wasmURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, "application/wasm"),
        });
        appendLog({ level: "info", message: "FFmpeg コアの読み込みが完了しました。" });
        setFfmpegReady(true);
      };

      ffmpegLoadPromise.current = loader().catch((error) => {
        ffmpegLoadPromise.current = null;
        throw error;
      });
    }

    await ffmpegLoadPromise.current;
    return ffmpegRef.current;
  }, [ffmpegReady]);

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setOutputUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setProgress(0);
      appendLog({
        level: "info",
        message: `ファイルを選択しました: ${file.name} (${formatBytes(file.size)})`,
      });
      NOTION_MESSAGES.forEach((message) => {
        appendLog({ level: "info", message });
      });
    }
  }, []);

  const handleCompress = useCallback(async () => {
    if (!selectedFile) {
      appendLog({ level: "error", message: "先に動画ファイルを選択してください。" });
      return;
    }

    setIsCompressing(true);
    setProgress(0);
    setOutputUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });

    try {
      const ffmpeg = await ensureFfmpeg();
      const inputName = selectedFile.name;
      await ffmpeg.writeFile(inputName, await fetchFile(selectedFile));

      const filter = getScaleFilter(resolution);
      const args = ["-i", inputName];

      if (filter) {
        args.push("-vf", filter);
      }

      args.push(
        "-c:v",
        format === "mp4" ? "libx264" : "libvpx-vp9",
        "-preset",
        preset,
        "-crf",
        crf.toString(),
        "-c:a",
        "copy",
      );

      if (format === "webm") {
        args.push("-b:v", "0");
      }

      args.push(outputName);

      const resolutionLabel = resolution === "original" ? "元の解像度" : `${resolution}p`;
      appendLog({
        level: "info",
        message: `圧縮を開始しました（プリセット: ${preset}, CRF: ${crf}, 解像度: ${resolutionLabel}）。`,
      });

      await ffmpeg.exec(args);

      const data = await ffmpeg.readFile(outputName);
      const url = URL.createObjectURL(
        new Blob([data.buffer], { type: format === "mp4" ? "video/mp4" : "video/webm" }),
      );

      setOutputUrl(url);
      appendLog({
        level: "info",
        message: `圧縮が完了しました。出力サイズ: ${formatBytes(data.length)}。`,
      });

      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog({ level: "error", message: `圧縮に失敗しました: ${message}` });
    } finally {
      const ffmpeg = ffmpegRef.current;
      if (ffmpeg && selectedFile) {
        const namesToClean = [selectedFile.name, outputName];
        await Promise.all(
          namesToClean.map(async (name) => {
            try {
              await ffmpeg.deleteFile(name);
            } catch (cleanupError) {
              const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
              if (!message.includes("ENOENT")) {
                console.warn("一時ファイルの削除でエラーが発生しました", cleanupError);
              }
            }
          }),
        );
      }
      setIsCompressing(false);
      setProgress(0);
    }
  }, [crf, ensureFfmpeg, format, outputName, preset, resolution, selectedFile]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F4F1EC] via-[#F7F5F0] to-[#ECE9E3] text-slate-900">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-10 md:py-16">
        <header className="space-y-4">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">個人ツール・プロトタイプ</p>
          <h1 className="text-3xl font-semibold leading-tight text-slate-900 sm:text-4xl">
            Notion向けブラウザ動画圧縮ツール
          </h1>
          <div className="text-sm leading-relaxed text-slate-600 sm:text-base space-y-1">
            {NOTION_MESSAGES.map((message, index) => (
              <span key={index} className="block">
                {message}
              </span>
            ))}
          </div>
        </header>

        <section className="space-y-8">
          <div className="space-y-6 rounded-3xl bg-white/80 p-6 shadow-[0_20px_50px_-30px_rgba(15,23,42,0.4)] backdrop-blur">
            <div className="space-y-4">
              <label className="block text-sm font-medium text-slate-700">動画をアップロード</label>
              <label
                htmlFor="video-input"
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-8 text-center transition hover:border-slate-400"
              >
                <span className="text-sm font-semibold text-slate-700">
                  {selectedFile ? selectedFile.name : "動画ファイルを選択またはドラッグ＆ドロップ"}
                </span>
                <span className="text-xs text-slate-500">
                  MP4 / MOV / WEBM などに対応。処理はすべてブラウザ内で完結します。
                </span>
                <input
                  id="video-input"
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  出力形式
                </label>
                <select
                  value={format}
                  onChange={(event) => setFormat(event.target.value as VideoFormat)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                >
                  <option value="mp4">MP4 (H.264 / 高互換性)</option>
                  <option value="webm">WEBM (VP9 / 高圧縮)</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  プリセット
                </label>
                <select
                  value={preset}
                  onChange={(event) => setPreset(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                >
                  <option value="ultrafast">Ultrafast（最速・低画質）</option>
                  <option value="superfast">Superfast</option>
                  <option value="veryfast">Veryfast（バランス推奨）</option>
                  <option value="faster">Faster</option>
                  <option value="fast">Fast</option>
                  <option value="medium">Medium（高画質・時間長め）</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  画質 (CRF {crf})
                </label>
                <input
                  type="range"
                  min={18}
                  max={34}
                  value={crf}
                  onChange={(event) => setCrf(Number(event.target.value))}
                  className="w-full"
                />
                <p className="text-xs text-slate-500">
                  数値が小さいほど高画質・大きなファイルになります。Notion の 5 MB 制限を意識しましょう。
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  解像度
                </label>
                <select
                  value={resolution}
                  onChange={(event) => setResolution(event.target.value as ResolutionOption)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                >
                  <option value="original">元の解像度</option>
                  <option value="1080">1080p 以下</option>
                  <option value="720">720p 以下</option>
                  <option value="480">480p 以下</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleCompress}
                disabled={isCompressing || !selectedFile}
                className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {isCompressing ? "圧縮中..." : "動画を圧縮"}
              </button>
              {isCompressing && (
                <div className="text-xs font-medium text-slate-600">進捗 {progress}%</div>
              )}
            </div>

            {outputUrl && (
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                <h2 className="text-sm font-semibold text-slate-700">圧縮結果</h2>
                <p className="text-xs text-slate-500">
                  {outputName && `出力ファイル: ${outputName}`}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href={outputUrl}
                    download={outputName}
                    className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
                  >
                    ダウンロード
                  </a>
                  <video
                    controls
                    src={outputUrl}
                    className="h-40 w-full rounded-lg border border-slate-200 object-cover md:w-64"
                  />
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default App;
