// palette.js — Command/Ctrl+K palette for DocSearch. Reuses api.js + i18n.js + docsearch.js.
// Does NOT mutate search.js state and does NOT hijack #query/#contentQuery focus.
import * as api from "./api.js";
import { t } from "./i18n.js";
import { contentTypeIcon, deriveBreadcrumb } from "./docsearch.js";

const RECENT_KEY="ds-recent", FAV_KEY="ds-fav";
const RECENT_MAX=7, RECENT_WITH_FAV_MAX=4, DEBOUNCE=200, STALL=500;
let el={}, lastFocused=null, debTimer=0, stallTimer=0, reqSeq=0, activeIndex=-1, rows=[];

function lsGet(k){ try { return JSON.parse(localStorage.getItem(k))||[]; } catch { return []; } }
function lsSet(k,v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
const recents=()=>lsGet(RECENT_KEY), favs=()=>lsGet(FAV_KEY);
function pushRecent(q){ q=(q||"").trim(); if(!q) return;
  const cap = favs().length ? RECENT_WITH_FAV_MAX : RECENT_MAX;
  lsSet(RECENT_KEY,[q,...recents().filter(x=>x!==q)].slice(0,cap)); }
export function toggleFavorite(q){ q=(q||"").trim(); if(!q) return;
  const f=favs(), i=f.indexOf(q); if(i>=0) f.splice(i,1); else f.unshift(q); lsSet(FAV_KEY,f.slice(0,10)); }

function ctxPath(){ const e=document.getElementById("contextPath"); return (e&&e.value)||""; }
function goSearch(q){ location.assign(`${ctxPath()}/search?q=${encodeURIComponent(q)}`); }
function goChat(q){ location.assign(`${ctxPath()}/chat?q=${encodeURIComponent(q)}`); }
function ragEnabled(){ const c=api.getConfig&&api.getConfig(); return !!(c&&c.features&&c.features.rag_chat_enabled); }
// click-logged doc nav: build /go/ from the palette's OWN search response (queryId+rt); else direct.
function goDoc(d, queryId, rt, order){
  if(queryId && d.doc_id && rt){
    location.assign(`${ctxPath()}/go/?rt=${encodeURIComponent(rt)}&queryId=${encodeURIComponent(queryId)}&docId=${encodeURIComponent(d.doc_id)}&order=${order}`);
  } else { location.assign(d.url); }
}

export function open(prefill){
  lastFocused=document.activeElement; el.root.hidden=false; document.body.style.overflow="hidden";
  el.input.value=prefill||""; el.input.setAttribute("aria-expanded","false"); el.input.focus();
  if(prefill) onInput(); else renderEmpty();
}
export function close(){ if(el.root.hidden) return;
  el.root.hidden=true; document.body.style.overflow=""; clearTimeout(debTimer); clearTimeout(stallTimer);
  activeIndex=-1; rows=[]; if(lastFocused&&lastFocused.focus) lastFocused.focus(); }

function clearList(){ el.listbox.replaceChildren(); rows=[]; activeIndex=-1; el.input.removeAttribute("aria-activedescendant"); }
function groupHeader(label){ const li=document.createElement("li"); li.className="ds-palette-group";
  li.setAttribute("role","presentation"); li.textContent=label; el.listbox.appendChild(li); }
function makeRow(id,{iconHtml,title,sub,onSelect}){
  const li=document.createElement("li"); li.id=id; li.setAttribute("role","option");
  li.className="ds-palette-row"; li.setAttribute("aria-selected","false");
  const ic=document.createElement("span"); ic.className="ds-palette-row-icon";
  if(iconHtml) ic.innerHTML=iconHtml;                 // static SVG/emoji constant only — XSS-safe
  const body=document.createElement("span"); body.className="ds-palette-row-body";
  const tt=document.createElement("span"); tt.className="ds-palette-row-title"; tt.textContent=title; body.appendChild(tt);
  if(sub){ const s=document.createElement("span"); s.className="ds-palette-row-sub"; s.textContent=sub; body.appendChild(s); }
  li.append(ic,body); li.addEventListener("click",onSelect);
  li.addEventListener("mousemove",()=>setActive(rows.indexOf(li)));
  el.listbox.appendChild(li); rows.push(li); li._onSelect=onSelect; return li;
}
function setActive(i){ if(i<0||i>=rows.length) return;
  rows.forEach(r=>r.setAttribute("aria-selected","false"));
  activeIndex=i; const r=rows[i]; r.setAttribute("aria-selected","true");
  el.input.setAttribute("aria-activedescendant",r.id); r.scrollIntoView({block:"nearest"}); }
function move(d){ if(!rows.length) return; let i=activeIndex+d; if(i<0) i=rows.length-1; if(i>=rows.length) i=0; setActive(i); }

function renderEmpty(){
  clearList(); el.empty.replaceChildren(); el.input.setAttribute("aria-expanded","false");
  el.empty.hidden=false; el.listbox.hidden=true;
  const queryRow=(q,isFav)=>{ const li=document.createElement("li"); li.className="ds-palette-row";
    const b=document.createElement("button"); b.type="button"; b.className="ds-palette-row-body"; b.textContent=q;
    b.addEventListener("click",()=>{ el.input.value=q; onInput(); });
    const star=document.createElement("button"); star.type="button"; star.className="ds-palette-star"+(isFav?" is-fav":"");
    star.setAttribute("aria-label", t(isFav?"palette.remove_search":"palette.save_search")); star.textContent=isFav?"★":"☆";
    star.addEventListener("click",(e)=>{ e.stopPropagation(); toggleFavorite(q); renderEmpty(); });
    li.append(b,star); return li; };
  const sec=(titleKey,items,render)=>{ if(!items.length) return;
    const h=document.createElement("div"); h.className="ds-palette-group"; h.textContent=t(titleKey); el.empty.appendChild(h);
    const ul=document.createElement("ul"); ul.className="ds-palette-empty-list"; items.forEach(it=>ul.appendChild(render(it))); el.empty.appendChild(ul); };
  sec("palette.favorites", favs(), q=>queryRow(q,true));
  sec("palette.recent", recents(), q=>queryRow(q,false));
  if(!favs().length && !recents().length){ const p=document.createElement("p"); p.className="ds-palette-norecent"; p.textContent=t("palette.no_recent"); el.empty.appendChild(p); }
}

function onInput(){
  const q=el.input.value.trim(); clearTimeout(debTimer); clearTimeout(stallTimer);
  if(!q){ renderEmpty(); return; }
  el.empty.hidden=true; el.listbox.hidden=false;
  stallTimer=setTimeout(()=>{ el.status.textContent=t("palette.loading"); }, STALL);
  debTimer=setTimeout(()=>runQuery(q), DEBOUNCE);
}
async function runQuery(q){
  const seq=++reqSeq; let words=[], hits=[], queryId="", rt="";
  try {
    const [sw, sr] = await Promise.all([
      api.get("/suggest-words", { q, num:5, fn:["_default","content","title"] }).catch(()=>null),
      api.get("/search", { q, num:5, start:0 }).catch(()=>null),
    ]);
    words = sw && Array.isArray(sw.suggest_words) ? sw.suggest_words.map(it=>it.text).filter(Boolean).slice(0,5) : [];
    if(sr){ queryId=sr.query_id||""; rt=sr.requested_time||sr.rt||"";
      hits=(sr.data||[]).map(d=>({ title:d.content_title||d.title||d.url, url:d.url_link||d.url,
        site:d.site_path||d.site, mimetype:d.mimetype, filetype:d.filetype, doc_id:d.doc_id }))
        .filter(d=>d.url).slice(0,5); }
  } catch {}
  if(seq!==reqSeq) return;                              // drop stale
  clearTimeout(stallTimer); clearList(); el.input.setAttribute("aria-expanded","true"); let n=0;
  if(words.length){ groupHeader(t("palette.suggestions"));
    words.forEach(w=>makeRow(`pal-s-${n++}`,{ title:w, onSelect:()=>{ pushRecent(w); goSearch(w); } })); }
  if(hits.length){ groupHeader(t("palette.documents"));
    hits.forEach((d,i)=>makeRow(`pal-h-${n++}`,{ iconHtml:contentTypeIcon(d),
      title: (d.title||"").replace(/<[^>]+>/g,""),         // content_title may carry highlight markup → strip for textContent row
      sub: deriveBreadcrumb({ url:d.url, site:d.site }).join(" › "),
      onSelect:()=>{ pushRecent(q); goDoc(d, queryId, rt, i); } })); }
  if(ragEnabled()){ groupHeader(t("palette.ask_ai_group"));
    makeRow("pal-ai",{ iconHtml:'<span class="ds-ai-spark" aria-hidden="true">✨</span>',
      title:t("ai.ask_about",{0:q}), onSelect:()=>{ pushRecent(q); goChat(q); } }); }
  if(!rows.length){ el.status.textContent=t("search.no_results");
    const li=document.createElement("li"); li.className="ds-palette-norecent"; li.textContent=t("search.no_results"); el.listbox.appendChild(li); }
  else { el.status.textContent=t("palette.result_count",{0:rows.length}); setActive(0); }
}

function onInputKeydown(e){
  if(e.key==="ArrowDown"){ e.preventDefault(); move(1); }
  else if(e.key==="ArrowUp"){ e.preventDefault(); move(-1); }
  else if(e.key==="Enter"){ e.preventDefault();
    if(activeIndex>=0 && rows[activeIndex]?._onSelect) rows[activeIndex]._onSelect();
    else { const q=el.input.value.trim(); if(q){ pushRecent(q); goSearch(q); } } }
  else if(e.key==="Escape"){ e.preventDefault(); close(); }
}
function globalKeydown(e){
  const k=(e.key||"").toLowerCase();
  if((e.metaKey||e.ctrlKey)&&k==="k"){ e.preventDefault(); el.root.hidden?open():close(); return; }
  if(e.key==="/"&&!e.metaKey&&!e.ctrlKey&&!e.altKey){
    const ae=document.activeElement, tag=(ae&&ae.tagName)||"";
    if(el.root.hidden && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag) && !(ae&&ae.isContentEditable)){ e.preventDefault(); open(); }
  }
}
function trapTab(e){ if(e.key!=="Tab") return;
  const f=el.panel.querySelectorAll('input,button,[href],[tabindex]:not([tabindex="-1"])'); if(!f.length) return;
  const first=f[0], last=f[f.length-1];
  if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); } }

export function init(){
  el.root=document.getElementById("palette"); if(!el.root) return;
  el.panel=el.root.querySelector(".ds-palette-panel");
  el.input=document.getElementById("palette-input");
  el.listbox=document.getElementById("palette-listbox");
  el.empty=document.getElementById("palette-empty");
  el.status=document.getElementById("palette-status");
  el.input.addEventListener("input", onInput);
  el.input.addEventListener("keydown", onInputKeydown);
  el.root.addEventListener("keydown", trapTab);
  document.addEventListener("keydown", globalKeydown);
  el.root.querySelectorAll("[data-palette-dismiss]").forEach(b=>b.addEventListener("click", close));
  const trig=document.getElementById("palette-trigger"); if(trig) trig.addEventListener("click",()=>open());
  // NOTE: deliberately NO focus/handler on #query or #contentQuery — they keep their native suggest behavior.
}
