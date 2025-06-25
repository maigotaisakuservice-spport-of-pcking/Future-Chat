// main.js - Future AI (画像生成なし完全版)
// ※ 動画生成・ファイル分析・チャットAI（Phi/Gemma切替）対応済み

(async () => {
  const NG_WORDS = ["ばか", "しね", "あほ", "くそ"];
  const TIMEOUT_MS = 30000;
  const VIDEO_OK = /Windows|Macintosh|Linux/.test(navigator.userAgent);
  const modeSelect = document.getElementById("mode");
  const userInput = document.getElementById("userInput");
  const fileInput = document.getElementById("fileInput");
  const sendBtn = document.getElementById("sendBtn");
  const output = document.getElementById("output");

  let timeoutId;
  let history = [];
  let llmModel = null;
  let ffmpeg = null;

  // ユーザー端末判定でモデル切替
  function isMobile() {
    return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }
  const modelName = isMobile()
    ? "Phi-3-mini-4k-instruct-q4f32_1"
    : "Gemma-2b-it-q4f32_1";

  // ログ出力
  function append(text, type = "text") {
    const div = document.createElement("div");
    div.className = `output-item ${type}`;
    if (type === "text" || type === "error") {
      div.textContent = text;
    } else if (type === "html") {
      div.innerHTML = text;
    } else if (type === "video") {
      const video = document.createElement("video");
      video.src = text;
      video.controls = true;
      div.appendChild(video);
    }
    output.appendChild(div);
    output.scrollTop = output.scrollHeight;
  }

  function clearOutput() {
    output.textContent = "";
  }

  function checkNGWords(text) {
    return NG_WORDS.some((word) => text.includes(word));
  }

  function setTimeoutGuard() {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      append("エラー: 30秒応答なし", "error");
    }, TIMEOUT_MS);
  }

  function updateUI() {
    const mode = modeSelect.value;
    userInput.style.display = mode === "file" ? "none" : "block";
    fileInput.style.display = mode === "file" ? "block" : "none";
    sendBtn.disabled = mode === "video" && !VIDEO_OK;
    if (mode === "video" && !VIDEO_OK) {
      append("動画生成はPCのみ対応です", "error");
    }
  }

  // LLM初期化
  async function initLLM() {
    append(`LLMモデル「${modelName}」をロード中…`);
    llmModel = await webllm.createEngine(modelName);
    await llmModel.reload();
    append("LLM初期化完了");
  }

  // ffmpeg初期化
  async function initFFmpeg() {
    append("ffmpegロード中…");
    ffmpeg = FFmpeg.createFFmpeg({ log: false });
    await ffmpeg.load();
    append("ffmpeg初期化完了");
  }

  // チャット処理
  async function chat(prompt) {
    history.push({ role: "user", content: prompt });
    if (history.length > 20) history.shift();
    const res = await llmModel.chat.completion({
      messages: history,
      max_tokens: 512,
    });
    const answer = res.message.content;
    history.push({ role: "assistant", content: answer });
    return answer;
  }

  // 動画生成処理
  async function generateVideo() {
    if (!VIDEO_OK) throw "動画生成はPCのみ対応です";

    const canvas = document.createElement("canvas");
    if (typeof canvas.captureStream !== "function") {
      throw "このブラウザはCanvasのcaptureStreamに対応していません。ChromeやEdgeの最新版を推奨します。";
    }

    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext("2d");

    const fps = 120;
    let durationSec = 10;
    try {
      const inputSec = prompt("動画秒数を入力してください（最大360秒）", "10");
      durationSec = Math.min(Math.max(parseInt(inputSec) || 10, 1), 360);
    } catch {
      durationSec = 10;
    }

    const stream = canvas.captureStream(fps);
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);

    recorder.start();

    for (let i = 0; i < fps * durationSec; i++) {
      ctx.fillStyle = `hsl(${(i / fps) * 10 % 360}, 50%, 50%)`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await new Promise((r) => setTimeout(r, 1000 / fps));
    }

    recorder.stop();

    await new Promise((r) => (recorder.onstop = r));

    const blob = new Blob(chunks, { type: "video/webm" });
    const buf = await blob.arrayBuffer();

    ffmpeg.FS("writeFile", "input.webm", new Uint8Array(buf));
    await ffmpeg.run("-i", "input.webm", "-vf", "fps=120", "-s", "1920x1080", "-c:v", "libx264", "-pix_fmt", "yuv420p", "output.mp4");

    const data = ffmpeg.FS("readFile", "output.mp4");
    const url = URL.createObjectURL(new Blob([data.buffer], { type: "video/mp4" }));

    return url;
  }

  // ファイル解析処理
  async function analyzeFile(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    const url = URL.createObjectURL(file);

    if (ext === "pdf") {
      const pdf = await pdfjsLib.getDocument(url).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((item) => item.str).join("") + "\n";
      }
      return text;
    } else if (["png", "jpg", "jpeg"].includes(ext)) {
      const { data: { text } } = await Tesseract.recognize(url);
      return text;
    } else if (ext === "csv") {
      const txt = await file.text();
      const parsed = Papa.parse(txt, { header: true });
      return JSON.stringify(parsed.data, null, 2);
    } else if (ext === "docx") {
      const arrayBuffer = await file.arrayBuffer();
      const doc = await docx.DocxJS.load(arrayBuffer);
      return doc.getFullText();
    } else {
      return `未対応のファイル形式: ${ext}`;
    }
  }

  // Wikipedia検索＋要約
  async function wikiSearch(query) {
    const res = await fetch(`https://ja.wikipedia.org/w/api.php?action=query&origin=*&format=json&prop=extracts&exintro&explaintext&redirects=1&titles=${encodeURIComponent(query)}`);
    const pages = Object.values((await res.json()).query.pages);
    const extract = pages[0]?.extract || "";
    const summaryRes = await llmModel.chat.completion({
      messages: [{ role: "user", content: `以下の文章を日本語で簡潔に要約してください:\n\n${extract}` }],
      max_tokens: 256,
    });
    return summaryRes.message.content;
  }

  async function send() {
    clearTimeout(timeoutId);

    const mode = modeSelect.value;
    const text = userInput.value.trim();
    const file = fileInput.files[0];

    if (mode !== "file" && !text) {
      append("入力が空です", "error");
      return;
    }
    if (mode === "file" && !file) {
      append("ファイルが選択されていません", "error");
      return;
    }
    if (checkNGWords(text)) {
      append("NGワードが含まれています", "error");
      return;
    }
    if (mode === "video" && !VIDEO_OK) {
      append("動画生成はPCのみ対応です", "error");
      return;
    }

    append(`▶ ${mode === "file" ? file.name : text}`, "text");
    setTimeoutGuard();

    try {
      if (mode === "chat") {
        const reply = await chat(text);
        append(reply, "text");
      } else if (mode === "video") {
        const videoUrl = await generateVideo();
        append(videoUrl, "video");
      } else if (mode === "search") {
        const summary = await wikiSearch(text);
        append(summary, "text");
      } else if (mode === "file") {
        const analysis = await analyzeFile(file);
        append(analysis, "text");
      }
    } catch (e) {
      append(`エラー: ${e}`, "error");
    }
  }

  modeSelect.onchange = () => {
    clearOutput();
    updateUI();
  };

  sendBtn.onclick = send;

  userInput.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  updateUI();
  sendBtn.disabled = true;
  append("初期化中…", "text");

  try {
    await initLLM();
    await initFFmpeg();
    append("準備完了！", "text");
    sendBtn.disabled = false;
  } catch (e) {
    append(`初期化エラー: ${e}`, "error");
  }
})();
