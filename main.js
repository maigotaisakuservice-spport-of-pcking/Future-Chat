// main.js
(async ()=> {
  const NG_WORDS=["ばか","しね","あほ","くそ"], TIMEOUT=30000,
        VIDEO_OK=/Windows|Macintosh|Linux/.test(navigator.userAgent),
        modeS=document.getElementById("mode"),
        inp=document.getElementById("userInput"),
        fInp=document.getElementById("fileInput"),
        btn=document.getElementById("sendBtn"),
        out=document.getElementById("output");
  let timeoutId, history=[], llmModel, imgModel, ffmpeg, pdfjsLib=window["pdfjs-dist/build/pdf"], zip=window.jszip, Tesseract, docx, Papa;

  // 出力ヘルパー
  function append(content,type="text"){
    const d=document.createElement("div");d.className="output-item "+type;
    if(type==="text"||type==="error")d.textContent=content;
    else if(type==="html")d.innerHTML=content;
    else if(type==="image"){ let img=document.createElement("img"); img.src=content; d.append(img);}
    else if(type==="video"){ let vid=document.createElement("video"); vid.src=content; vid.controls=true; d.append(vid);}
    out.append(d); out.scrollTop=out.scrollHeight;
  }
  function clearO(){ out.textContent=""; }
  function ngCheck(s){return NG_WORDS.some(w=>s.includes(w));}

  function setTO(){clearTimeout(timeoutId); timeoutId=setTimeout(()=>append("エラー: 30秒応答なし","error"),TIMEOUT);}
  function updateUI(){
    const m=modeS.value;
    inp.style.display=m==="file"?"none":"block";
    fInp.style.display=m==="file"?"block":"none";
    btn.disabled=(m==="video"&&!VIDEO_OK);
    if(m==="video"&&!VIDEO_OK)append("動画生成はPCのみ","error");
  }

  // 初期化各種
  async function initLLM(){
    append("LLMロード中…");
    llmModel=await webllm.createEngine("Llama-3-8B-Instruct-q4f32_1");
    await llmModel.reload();
    append("LLM初期化完了");
  }
  async function initIMG(){
    append("画像モデルロード中…");
    imgModel={}; // 実装者向け Hook-inpoint
    append("画像モデル初期化完了");
  }
  async function initFFM(){
    append("ffmpegロード中…");
    ffmpeg = FFmpeg.createFFmpeg({log:false});
    await ffmpeg.load();
    append("ffmpeg初期化完了");
  }
  function chat(prompt){
    history.push({role:"user",content:prompt});
    if(history.length>20)history.shift();
    return llmModel.chat.completion({messages:history,max_tokens:512})
      .then(res=>{let r=res.message.content; history.push({role:"assistant",content:r}); return r;});
  }
  async function genIMG(p){
    return imgModel.generate?p:"";
  }
  async function genVIDEO(p){
    if(!VIDEO_OK) throw"PCのみ";
    const c=document.createElement("canvas"),ctx=c.getContext("2d");
    c.width=1920; c.height=1080;
    const fps=120, duration=Math.min(360, parseInt(prompt("秒数(最大360):"))||10);
    const rec=captureStream?c.captureStream(fps):null;
    const recd=new MediaRecorder(rec||c.captureStream());
    const ch=[]; recd.ondataavailable=e=>ch.push(e.data);
    recd.start();
    for(let i=0;i<fps*duration;i++){
      ctx.fillStyle=`hsl(${(i/fps)*10%360},50%,50%)`;
      ctx.fillRect(0,0,1920,1080);
      await new Promise(r=>setTimeout(r,1000/fps));
    }
    recd.stop();
    await new Promise(r=>recd.onstop=r);
    const blob=new Blob(ch,{type:"video/webm"}), buf=await blob.arrayBuffer();
    ffmpeg.FS("writeFile","in.webm",new Uint8Array(buf));
    await ffmpeg.run("-i","in.webm","-vf","fps=120","out.mp4");
    const data=ffmpeg.FS("readFile","out.mp4");
    const url=URL.createObjectURL(new Blob([data.buffer],{type:"video/mp4"}));
    return url;
  }

  async function analyzeFile(f){
    const ext=f.name.split(".").pop().toLowerCase(), u=URL.createObjectURL(f);
    if(ext==="pdf"){
      const pdf=await pdfjsLib.getDocument(u).promise;
      let txt="";
      for(let p=1;p<=pdf.numPages;p++){
        const pg=await pdf.getPage(p),t=await pg.getTextContent();
        txt+=t.items.map(it=>it.str).join("")+"\n";
      }
      return txt;
    } else if(["png","jpg","jpeg"].includes(ext)){
      const { data:{ text } } = await Tesseract.recognize(u);
      return text;
    } else if(ext==="csv"){
      const txt=await f.text();
      return Papa.parse(txt,{header:true}).data;
    } else if(ext==="docx"){
      const array=await f.arrayBuffer();
      const doc=await docx.DocxJS.load(array);
      return doc.getFullText();
    } else return "未対応:"+ext;
  }

  async function wiki(q){
    const res=await fetch(`https://ja.wikipedia.org/w/api.php?action=query&origin=*&format=json&prop=extracts&exintro&explaintext&redirects=1&titles=${encodeURIComponent(q)}`);
    const pg=Object.values((await res.json()).query.pages)[0];
    const ext=pg.extract||"";
    const sum=await llmModel.chat.completion({messages:[{role:"user",content:`以下を要約:${ext}`}],max_tokens:256});
    return sum.message.content;
  }

  async function send(){
    clearTimeout(timeoutId);
    const m=modeS.value, text=inp.value.trim(), f=fInp.files[0]||null;
    if(text&&ngCheck(text)){append("NGワードあり","error");return;}
    if(m!=="file"&&!text){append("入力空","error");return;}
    if(m==="file"&&!f){append("ファイル未選択","error");return;}
    if(m==="video"&&!VIDEO_OK){append("動画不可","error");return;}
    append("▶ "+(text||f.name),"text");
    setTO();
    try {
      if(m==="chat") { append(await chat(text),"text"); }
      if(m==="image") { append(await genIMG(text),"image"); }
      if(m==="video"){ append(await genVIDEO(text),"video"); }
      if(m==="search"){ append(await wiki(text),"text"); }
      if(m==="file"){ append(await analyzeFile(f),"text"); }
    } catch(e){ append("エラー:"+e,"error"); }
  }

  modeS.onchange=()=>{clearO(); updateUI();}
  btn.onclick=send;
  inp.onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}};
  updateUI();
  append("初期化中…","text");
  await initLLM(); await initIMG(); await initFFM();
  append("準備完了！","text");
})();
