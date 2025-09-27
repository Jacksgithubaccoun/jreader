import React, { useEffect, useRef, useState } from 'react'

function makeFileKey(file) {
  return `reader:${file.name}:${file.size}:${file.lastModified}`
}

export default function App() {
  const [file, setFile] = useState(null)
  const [fileType, setFileType] = useState(null)
  const [pages, setPages] = useState([])
  const [current, setCurrent] = useState(0)
  const [doublePage, setDoublePage] = useState(false)
  const [dark, setDark] = useState(() => localStorage.getItem('reader:dark') === '1')
  const [zoom, setZoom] = useState(1)
  const [fitToWidth, setFitToWidth] = useState(true)
  const [fontSize, setFontSize] = useState(16)
  const [brightness, setBrightness] = useState(100)
  const [toc, setToc] = useState([])
  const [bookmarks, setBookmarks] = useState(() => JSON.parse(localStorage.getItem('reader:bookmarks') || '[]'))

  const epubRendRef = useRef(null)
  const pdfDocRef = useRef(null)

  // Persist dark mode
  useEffect(() => {
    document.documentElement.style.background = dark ? '#0b0b0b' : ''
    localStorage.setItem('reader:dark', dark ? '1' : '0')
  }, [dark])

  // Keyboard navigation
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') nextPage()
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') prevPage()
      if (e.key === 'd') setDark(d => !d)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, pages])

  // Persist reading position
  useEffect(() => {
    if (!file) return
    const key = makeFileKey(file) + ':pos'
    localStorage.setItem(key, String(current))
  }, [current, file])

  // Handle file input
  async function handleFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    sessionStorage.setItem('reader:lastFile', JSON.stringify({ name: f.name, size: f.size, lastModified: f.lastModified }))

    const ext = (f.name.split('.').pop() || '').toLowerCase()

    if (ext === 'epub') {
      await loadEPUB(f)
      setFileType('epub')
    } else if (ext === 'pdf') {
      await loadPDF(f)
      setFileType('pdf')
    } else if (ext === 'cbz' || ext === 'zip') {
      await loadCBZ(f)
      setFileType('cbz')
    } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
      const url = URL.createObjectURL(f)
      setPages([url])
      setCurrent(0)
      setFileType('images')
    } else if (['mobi', 'azw3'].includes(ext)) {
      alert('MOBI/AZW3 reading in-browser is limited. Convert to EPUB for best results.')
      const url = URL.createObjectURL(f)
      setPages([url])
      setCurrent(0)
      setFileType('mobi')
    } else {
      try {
        await loadCBZ(f)
        setFileType('cbz')
      } catch (err) {
        console.error(err)
        alert('Unsupported file type — try converting to EPUB, PDF, or CBZ')
      }
    }
  }

  // EPUB loader
  async function loadEPUB(fileObj) {
    const epubModule = await import('epubjs')
    const ePub = epubModule.default || epubModule
    const key = makeFileKey(fileObj) + ':pos'
    const book = ePub(fileObj)
    const rendition = book.renderTo('epub-container', { width: '100%', height: '100%' })
    epubRendRef.current = { book, rendition }
    rendition.themes.fontSize(`${fontSize}px`)
    rendition.display()
    const stored = localStorage.getItem(key)
    if (stored) rendition.display(stored).catch(() => {})
    book.loaded.navigation.then(n => setToc(n.toc || []))
    rendition.on('rendered', () => {
      const loc = rendition.currentLocation && rendition.currentLocation()
      if (loc && loc.start && loc.start.cfi) localStorage.setItem(key, loc.start.cfi)

      // Click & double-tap inside EPUB iframe
      const iframe = rendition.manager?.views?.[0]?.iframe
      if (iframe && iframe.contentDocument) {
        const doc = iframe.contentDocument
        doc.onclick = (e) => {
          const rect = iframe.getBoundingClientRect()
          const mid = rect.width / 2
          const clickX = e.clientX - rect.left
          if (clickX > mid) rendition.next()
          else rendition.prev()
        }
        doc.ontouchstart = (e) => {
          const now = Date.now()
          const body = doc.body
          if (body.dataset.lastTap && now - body.dataset.lastTap < 300) {
            if (!body.style.transform || body.style.transform === 'scale(1)') {
              body.style.transform = 'scale(1.5)'
              body.style.transformOrigin = 'center center'
            } else {
              body.style.transform = 'scale(1)'
            }
          }
          body.dataset.lastTap = now
        }
      }
    })
  }

  // PDF loader
  async function loadPDF(fileObj) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf')
    try {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.js', import.meta.url).toString()
    } catch (e) { console.warn('Could not set pdf.worker path automatically', e) }
    const arrayBuffer = await fileObj.arrayBuffer()
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer })
    const pdf = await loadingTask.promise
    pdfDocRef.current = pdf
    const n = pdf.numPages
    const imgs = []
    for (let p = 1; p <= n; p++) {
      const page = await pdf.getPage(p)
      const viewport = page.getViewport({ scale: 1 })
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      canvas.width = viewport.width
      canvas.height = viewport.height
      await page.render({ canvasContext: ctx, viewport }).promise
      imgs.push(canvas.toDataURL())
    }
    setPages(imgs)
    const key = makeFileKey(fileObj) + ':pos'
    const stored = localStorage.getItem(key)
    const idx = stored ? parseInt(stored, 10) : 0
    setCurrent(idx >= 0 && idx < imgs.length ? idx : 0)
  }

  // CBZ loader
  async function loadCBZ(fileObj) {
    const JSZip = (await import('jszip')).default || (await import('jszip'))
    const data = await fileObj.arrayBuffer()
    const zip = await JSZip.loadAsync(data)
    const imageFiles = []
    zip.forEach((path, fileEntry) => {
      const ext = path.split('.').pop().toLowerCase()
      if (['jpg','jpeg','png','gif','webp','bmp'].includes(ext)) imageFiles.push(path)
    })
    imageFiles.sort((a,b) => a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}))
    const imgs = []
    for (const p of imageFiles) {
      const f = zip.file(p)
      if (!f) continue
      const blob = await f.async('blob')
      imgs.push(URL.createObjectURL(blob))
    }
    setPages(imgs)
    const key = makeFileKey(fileObj) + ':pos'
    const stored = localStorage.getItem(key)
    const idx = stored ? parseInt(stored,10) : 0
    setCurrent(idx >=0 && idx<imgs.length ? idx : 0)
  }

  function nextPage() {
    if (fileType === 'epub' && epubRendRef.current) epubRendRef.current.rendition.next()
    else setCurrent(c => Math.min(c + (doublePage ? 2 : 1), pages.length - 1))
  }
  function prevPage() {
    if (fileType === 'epub' && epubRendRef.current) epubRendRef.current.rendition.prev()
    else setCurrent(c => Math.max(c - (doublePage ? 2 : 1), 0))
  }
  function jumpTo(i) {
    const idx = Math.max(0, Math.min(i, pages.length - 1))
    setCurrent(idx)
  }

  function addBookmark() {
    if (!file) return
    const key = makeFileKey(file)
    const b = { key, fileName: file.name, pos: current, when: Date.now() }
    const nb = [...bookmarks, b]
    setBookmarks(nb)
    localStorage.setItem('reader:bookmarks', JSON.stringify(nb))
    alert('Bookmark added')
  }

  function removeBookmark(i) {
    const nb = bookmarks.slice()
    nb.splice(i,1)
    setBookmarks(nb)
    localStorage.setItem('reader:bookmarks', JSON.stringify(nb))
  }

  function restoreBookmark(b) {
    if (b.fileName !== file?.name) {
      alert('Open the matching file to restore this bookmark.')
      return
    }
    setCurrent(b.pos)
  }

  function downloadCurrent() {
    if (!pages[current]) return
    const a = document.createElement('a')
    a.href = pages[current]
    a.download = `${file ? file.name : 'page'}.png`
    a.click()
  }

  return (
    <div className={`min-h-screen flex flex-col ${dark?'text-gray-200 bg-gray-900':'text-gray-900 bg-gray-50'}`}>
      <header className="p-3 flex items-center gap-3 shadow-sm">
        <h1 className="text-xl font-semibold">Manga / Comic / eBook Reader</h1>
        <div className="flex-1"/>
        <label className="flex items-center gap-2">
          <input className="hidden" type="file" accept=".epub,.pdf,.cbz,.zip,.mobi,.azw3,.jpg,.jpeg,.png,.gif,.webp" onChange={handleFile}/>
          <button className="px-3 py-2 rounded bg-blue-600 text-white">Open file</button>
        </label>
        <button className="ml-2 px-3 py-2 rounded border" onClick={()=>setDark(d=>!d)}>{dark?'Light':'Dark'}</button>
      </header>

      <main className="flex flex-1 gap-4 p-4">
        {/* Left Sidebar */}
        <aside className="w-64 hidden md:block">
          <div className="mb-4">
            <h2 className="font-medium">File</h2>
            <div className="mt-2 text-sm text-gray-400">{file?file.name:'No file opened'}</div>
          </div>

          <div className="mb-4">
            <h3 className="font-medium">Reader</h3>
            <div className="flex flex-col gap-2 mt-2 text-sm">
              <div>Mode: <strong>{fileType||'—'}</strong></div>
              <div>Page: {pages.length?`${current+1} / ${pages.length}`:'—'}</div>
              <div className="flex gap-2">
                <button className="px-2 py-1 border rounded" onClick={prevPage}>Prev</button>
                <button className="px-2 py-1 border rounded" onClick={nextPage}>Next</button>
              </div>
              <div className="flex gap-2 mt-2">
                <button className="px-2 py-1 border rounded" onClick={()=>setDoublePage(d=>!d)}>{doublePage?'Single':'Double'}</button>
                <button className="px-2 py-1 border rounded" onClick={()=>{setFitToWidth(true); setZoom(1)}}>Fit</button>
                <button className="px-2 py-1 border rounded" onClick={()=>setZoom(z=>z+0.1)}>Zoom +</button>
                <button className="px-2 py-1 border rounded" onClick={()=>setZoom(z=>Math.max(0.2,z-0.1))}>Zoom -</button>
              </div>
              <div className="mt-2">
                <label className="text-xs">Brightness</label>
                <input type="range" min="40" max="160" value={brightness} onChange={e=>setBrightness(e.target.value)}/>
              </div>
              <div>
                <button className="mt-2 px-3 py-2 rounded border" onClick={addBookmark}>Add bookmark</button>
              </div>
            </div>
          </div>

          <div className="mb-4">
            <h3 className="font-medium">Bookmarks</h3>
            <div className="mt-2">
              {bookmarks.length===0 && <div className="text-sm text-gray-400">No bookmarks yet</div>}
              {bookmarks.map((b,i)=>(
                <div key={i} className="flex items-center justify-between gap-2 text-sm py-1">
                  <div className="truncate" title={b.fileName}>{b.fileName} — {b.pos+1}</div>
                  <div className="flex gap-1">
                    <button className="px-1" onClick={()=>restoreBookmark(b)}>Go</button>
                    <button className="px-1 text-red-500" onClick={()=>removeBookmark(i)}>X</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Main Reader */}
        <section className="flex-1 flex flex-col" style={{minHeight:'60vh'}}>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex gap-2">
              <button className="px-3 py-1 border rounded" onClick={prevPage}>Prev</button>
              <button className="px-3 py-1 border rounded" onClick={nextPage}>Next</button>
            </div>
            <div className="ml-4">{pages.length?`${current+1} / ${pages.length}`:'No pages'}</div>
            <div className="ml-auto flex items-center gap-2">
              <button className="px-2 py-1 border rounded" onClick={downloadCurrent}>Download page</button>
            </div>
          </div>

          <div id="epub-container" className="flex-1 rounded shadow-sm overflow-auto relative" style={{background: dark?'#0b0b0b':'#fff', filter:`brightness(${brightness}%)`}}>
            {fileType==='epub' && <div className="w-full h-full"/>}

            {(fileType==='cbz'||fileType==='pdf'||fileType==='images'||fileType==='mobi') && (
              <div className="w-full h-full flex items-center justify-center p-4">
                {pages.length===0 && <div className="text-gray-400">No pages to display</div>}
                {pages.length>0 && (
                  <div className={`page-wrapper flex gap-2 ${doublePage?'double':''}`} style={{alignItems:'center'}}>
                    <img
                      draggable={false}
                      src={pages[current]}
                      alt={`page ${current+1}`}
                      className="max-h-[80vh] max-w-full cursor-pointer"
                      style={{transform:`scale(${zoom})`, objectFit: fitToWidth?'contain':'initial'}}
                      onClick={e=>{ const mid = e.currentTarget.getBoundingClientRect().width/2; e.nativeEvent.offsetX>mid?nextPage():prevPage() }}
                      onTouchStart={e=>{
                        const now=Date.now(); if(e.currentTarget.dataset.lastTap && now-e.currentTarget.dataset.lastTap<300) setZoom(z=>z===1?2:1); e.currentTarget.dataset.lastTap=now
                      }}
                    />
                    {doublePage && pages[current+1] && (
                      <img
                        draggable={false}
                        src={pages[current+1]}
                        alt={`page ${current+2}`}
                        className="max-h-[80vh] max-w-full cursor-pointer"
                        style={{transform:`scale(${zoom})`, objectFit: fitToWidth?'contain':'initial'}}
                        onClick={e=>{ const mid = e.currentTarget.getBoundingClientRect().width/2; e.nativeEvent.offsetX>mid?nextPage():prevPage() }}
                        onTouchStart={e=>{
                          const now=Date.now(); if(e.currentTarget.dataset.lastTap && now-e.currentTarget.dataset.lastTap<300) setZoom(z=>z===1?2:1); e.currentTarget.dataset.lastTap=now
                        }}
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            <div onTouchStart={e=>{e.currentTarget._sx=e.touches[0].clientX}} onTouchEnd={e=>{const sx=e.currentTarget._sx,ex=e.changedTouches[0].clientX; if(sx-ex>40) nextPage(); if(ex-sx>40) prevPage()}} className="absolute inset-0"/>
          </div>

          <div className="mt-3">
            <input type="range" min="1" max={Math.max(1,pages.length)} value={current+1} onChange={e=>jumpTo(Number(e.target.value)-1)} className="w-full"/>
            <div className="flex gap-2 mt-2 overflow-x-auto">
              {pages.slice(0,50).map((p,i)=>(
                <img key={i} src={p} alt={`thumb ${i+1}`} className={`h-20 object-contain border ${i===current?'ring-2 ring-blue-400':''}`} onClick={()=>jumpTo(i)}/>
              ))}
            </div>
          </div>
        </section>

        {/* Right Sidebar */}
        <aside className="w-60 hidden lg:block">
          <div>
            <h3 className="font-medium">Settings</h3>
            <div className="mt-2 text-sm">
              <div className="mb-2">Font size (for EPUB): {fontSize}px</div>
              <input type="range" min="12" max="36" value={fontSize} onChange={e=>{setFontSize(Number(e.target.value)); if(epubRendRef.current) epubRendRef.current.rendition.themes.fontSize(`${e.target.value}px`)}}/>
              <div className="mt-3">Zoom: {zoom.toFixed(1)}</div>
              <div className="mt-2">Double page: {doublePage?'On':'Off'}</div>
            </div>
          </div>
          <div className="mt-4">
            <h3 className="font-medium">TOC</h3>
            <div className="mt-2 text-sm max-h-64 overflow-auto">
              {toc.length===0 && <div className="text-gray-400">No table of contents</div>}
              {toc.map((t,i)=>(
                <div key={i} className="py-1 truncate" title={t.label}><button onClick={()=>{if(epubRendRef.current) epubRendRef.current.rendition.display(t.href)}}>{t.label}</button></div>
              ))}
            </div>
          </div>
        </aside>
      </main>

      <footer className="p-3 text-xs text-gray-500">Files are processed locally in your browser. Convert MOBI/AZW3 to EPUB for best results.</footer>
    </div>
  )
}
