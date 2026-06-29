import { useState, useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import {
  DndContext, closestCenter, PointerSensor,
  KeyboardSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, arrayMove,
  sortableKeyboardCoordinates, useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import products from './data/products.json'
import './App.css'

const VERSION = '2.2.0'
const SNAP = 80
const AUTO = 220
const QUEUE_KEY = 'trolley_queue'

function getCachedItems(code) {
  try { return JSON.parse(localStorage.getItem(`trolley_items_${code}`) || '[]') } catch { return [] }
}
function setCachedItems(code, items) {
  try { localStorage.setItem(`trolley_items_${code}`, JSON.stringify(items)) } catch {}
}

function getQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') } catch { return [] }
}
function saveQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)) } catch {}
}
function enqueue(op) {
  const q = getQueue(); q.push(op); saveQueue(q)
}

function getCustomProducts() {
  try { return JSON.parse(localStorage.getItem('trolley_custom_products') || '[]') } catch { return [] }
}
function upsertCustomProduct(name, categoryId) {
  const existing = getCustomProducts()
  const idx = existing.findIndex(p => p.name.toLowerCase() === name.toLowerCase())
  if (idx >= 0) existing[idx].category = categoryId
  else existing.push({ name, category: categoryId })
  try { localStorage.setItem('trolley_custom_products', JSON.stringify(existing)) } catch {}
}

// "2 onion" → { qty: "2x", name: "onion" }  |  "500g mince" → { qty: "500g", name: "mince" }
function parseInputQty(raw) {
  const s = raw.trim()
  let m
  m = s.match(/^(\d+(?:\.\d+)?(?:kg|g|ml|l|lbs?|oz))\s+(.+)$/i)
  if (m) return { qty: m[1].toLowerCase(), name: m[2] }
  m = s.match(/^(.+?)\s+(\d+(?:\.\d+)?(?:kg|g|ml|l|lbs?|oz))$/i)
  if (m) return { qty: m[2].toLowerCase(), name: m[1] }
  m = s.match(/^(\d+)x?\s+(.+)$/i)
  if (m) return { qty: `${m[1]}x`, name: m[2] }
  m = s.match(/^(.+?)\s+(\d+)$/)
  if (m && parseInt(m[2]) <= 99) return { qty: `${m[2]}x`, name: m[1] }
  return { qty: null, name: s }
}

// "2x Onions" → { qty: "2x", name: "Onions" }
function parseItemName(stored) {
  let m = stored.match(/^(\d+x)\s+(.+)$/i)
  if (m) return { qty: m[1], name: m[2] }
  m = stored.match(/^(\d+(?:\.\d+)?(?:kg|g|ml|l|lbs?|oz))\s+(.+)$/i)
  if (m) return { qty: m[1], name: m[2] }
  return { qty: null, name: stored }
}

function haptic(pattern = 10) {
  try { navigator.vibrate?.(pattern) } catch {}
}

function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return online
}

function SwipeItem({ item, onToggle, onDelete, onPick, getCat, lastTapRef, isEntering, isExiting, animEnabled }) {
  const [tx, _setTx] = useState(0)
  const [animate, setAnimate] = useState(false)
  const txRef = useRef(0)
  const rowRef = useRef(null)
  const onDeleteRef = useRef(onDelete)
  useEffect(() => { onDeleteRef.current = onDelete }, [onDelete])

  function setTx(v) { txRef.current = v; _setTx(v) }

  useEffect(() => {
    const el = rowRef.current
    if (!el) return
    let startX = 0, startY = 0, dir = null, baseX = 0

    function onStart(e) {
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      dir = null
      baseX = txRef.current
      setAnimate(false)
    }

    function onMove(e) {
      const dx = e.touches[0].clientX - startX
      const dy = e.touches[0].clientY - startY
      if (!dir) {
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5)
          dir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
        return
      }
      if (dir !== 'h') return
      e.preventDefault()
      setTx(Math.min(0, Math.max(-(AUTO + 20), baseX + dx)))
    }

    function onEnd() {
      if (dir !== 'h') return
      setAnimate(true)
      const t = txRef.current
      if (t < -AUTO) {
        setTx(-window.innerWidth)
        setTimeout(() => onDeleteRef.current(item.id), 260)
      } else if (t < -(SNAP / 2)) {
        setTx(-SNAP)
      } else {
        setTx(0)
      }
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
    }
  }, [item.id])

  function handleClick(e) {
    if (txRef.current !== 0) { setAnimate(true); setTx(0); return }
    if (e.target.closest('button')) return
    const now = Date.now()
    const last = lastTapRef.current[item.id] || 0
    if (now - last < 400) {
      lastTapRef.current[item.id] = 0
      onToggle(item.id, item.checked)
    } else {
      lastTapRef.current[item.id] = now
    }
  }

  const { qty, name: displayName } = parseItemName(item.name)

  return (
    <div className={`item-row-outer${animEnabled && isEntering ? ' item-enter' : ''}${animEnabled && isExiting ? ' item-exit' : ''}`}>
      <div className="swipe-wrapper">
        <div className="swipe-bg">
          <button className="swipe-delete-btn" onClick={() => {
            setAnimate(true)
            setTx(-window.innerWidth)
            setTimeout(() => onDeleteRef.current(item.id), 260)
          }}>Delete</button>
        </div>
        <div
          ref={rowRef}
          className={`swipe-row${animate ? ' animate' : ''}${item.checked ? ' checked' : ''}`}
          style={{ transform: `translateX(${tx}px)` }}
          onClick={handleClick}
          onDoubleClick={e => { if (!e.target.closest('button') && txRef.current === 0) onToggle(item.id, item.checked) }}
        >
          <button
            className={`check-btn${item.checked ? ' checked-btn' : ''}${animEnabled ? ' anim' : ''}`}
            onClick={e => { e.stopPropagation(); onToggle(item.id, item.checked) }}
          >
            <span className="checkmark">{item.checked ? '✓' : ''}</span>
          </button>
          {qty && <span className="item-qty">{qty}</span>}
          <span className="item-name">{displayName}</span>
          {!item.checked && (
            <button
              className="cat-change-btn"
              onClick={e => { e.stopPropagation(); onPick(item) }}
              title="Change category"
            >
              {getCat(item.category_id)?.icon ?? '🏷️'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function SortableCatItem({ id, cat }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <li
      ref={setNodeRef}
      className={`cat-order-item${isDragging ? ' dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
    >
      <span className="drag-handle" {...attributes} {...listeners}>⠿</span>
      <span className="cat-order-icon">{cat.icon}</span>
      <span className="cat-order-name">{cat.name}</span>
    </li>
  )
}

// Bottom sheet with swipe-down-to-close
function BottomSheet({ onClose, children }) {
  const sheetRef = useRef(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    const el = sheetRef.current
    if (!el) return
    let startY = 0, startTime = 0, currentY = 0, engaged = false

    function onStart(e) {
      startY = e.touches[0].clientY
      startTime = Date.now()
      currentY = 0
      engaged = false
      el.style.transition = 'none'
    }

    function onMove(e) {
      const dy = e.touches[0].clientY - startY
      if (dy <= 0) { engaged = false; return }
      const bodyEl = el.querySelector('.sheet-body')
      if (!engaged && bodyEl && bodyEl.scrollTop > 0) return
      engaged = true
      currentY = dy
      el.style.transform = `translateY(${dy}px)`
      e.preventDefault()
    }

    function onEnd() {
      if (!engaged) { el.style.transition = ''; return }
      const elapsed = Date.now() - startTime
      const velocity = currentY / elapsed
      if (currentY > 100 || velocity > 0.4) {
        el.style.transition = 'transform 0.25s ease'
        el.style.transform = `translateY(100%)`
        setTimeout(() => onCloseRef.current(), 250)
      } else {
        el.style.transition = 'transform 0.25s ease'
        el.style.transform = ''
      }
      engaged = false
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
    }
  }, [])

  return (
    <div ref={sheetRef} className="sheet" onClick={e => e.stopPropagation()}>
      {children}
    </div>
  )
}

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

async function flushQueue() {
  const q = getQueue()
  if (!q.length) return
  const failed = []
  for (const op of q) {
    try {
      if (op.type === 'INSERT') await supabase.from('list_items').upsert(op.data, { onConflict: 'id' })
      else if (op.type === 'UPDATE') await supabase.from('list_items').update(op.data).eq('id', op.id)
      else if (op.type === 'DELETE') await supabase.from('list_items').delete().eq('id', op.id)
    } catch { failed.push(op) }
  }
  saveQueue(failed)
}

function loadCategoryOrder() {
  try {
    const saved = localStorage.getItem('trolley_cat_order')
    if (saved) {
      const parsed = JSON.parse(saved)
      const allIds = products.categories.map(c => c.id)
      const missing = allIds.filter(id => !parsed.includes(id))
      return [...parsed, ...missing]
    }
  } catch {}
  return products.categories.map(c => c.id)
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem('trolley_history') || '[]') } catch { return [] }
}

export default function App() {
  const [listCode, setListCode] = useState(null)
  const [inputCode, setInputCode] = useState('')
  const [items, setItems] = useState([])
  const [input, setInput] = useState('')
  const [inputQty, setInputQty] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pickerItem, setPickerItem] = useState(null)
  const [categoryOrder, setCategoryOrder] = useState(loadCategoryOrder)
  const [tab, setTab] = useState('list')
  const [historySearch, setHistorySearch] = useState('')
  const [history, setHistory] = useState(loadHistory)
  const [settingsView, setSettingsView] = useState('main')
  const [settingsJoinCode, setSettingsJoinCode] = useState('')
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('trolley_theme') || 'dark'
    document.documentElement.setAttribute('data-theme', saved)
    return saved
  })
  const [animEnabled, setAnimEnabled] = useState(() => localStorage.getItem('trolley_animations') !== 'off')
  const [enteringIds, setEnteringIds] = useState(() => new Set())
  const [exitingIds, setExitingIds] = useState(() => new Set())

  const inputRef = useRef(null)
  const channelRef = useRef(null)
  const lastTapRef = useRef({})
  const listCodeRef = useRef(null)
  const locallyAddedIdsRef = useRef(new Set())
  const itemsRef = useRef([])
  const online = useOnlineStatus()
  const prevOnlineRef = useRef(true)

  useEffect(() => { itemsRef.current = items }, [items])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd({ active, over }) {
    if (over && active.id !== over.id) {
      setCategoryOrder(prev => {
        const oldIndex = prev.indexOf(active.id)
        const newIndex = prev.indexOf(over.id)
        return arrayMove(prev, oldIndex, newIndex)
      })
    }
  }

  useEffect(() => {
    const saved = localStorage.getItem('trolley_code')
    if (saved) {
      setListCode(saved)
      listCodeRef.current = saved
      loadAndSubscribe(saved)
    }
    return () => channelRef.current?.unsubscribe()
  }, [])

  useEffect(() => {
    localStorage.setItem('trolley_cat_order', JSON.stringify(categoryOrder))
  }, [categoryOrder])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('trolley_theme', theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('trolley_animations', animEnabled ? 'on' : 'off')
  }, [animEnabled])

  function toggleTheme() { setTheme(t => t === 'dark' ? 'light' : 'dark') }

  function markEntering(id) {
    setEnteringIds(prev => new Set([...prev, id]))
    setTimeout(() => setEnteringIds(prev => { const s = new Set(prev); s.delete(id); return s }), 400)
  }

  function openSettings() { setSettingsView('main'); setSettingsOpen(true) }

  function closeSettings() {
    setSettingsOpen(false)
    setSettingsView('main')
    setSettingsJoinCode('')
  }

  async function switchList(code) {
    const clean = code.trim().toUpperCase()
    if (!clean) return
    closeSettings()
    localStorage.setItem('trolley_code', clean)
    listCodeRef.current = clean
    setListCode(clean)
    await loadAndSubscribe(clean)
  }

  useEffect(() => {
    if (online && !prevOnlineRef.current && listCodeRef.current) {
      loadAndSubscribe(listCodeRef.current)
    }
    prevOnlineRef.current = online
  }, [online])

  function recordHistory(item) {
    setHistory(prev => {
      const existing = [...prev]
      const idx = existing.findIndex(h => h.name.toLowerCase() === item.name.toLowerCase())
      const entry = {
        name: item.name,
        category_id: item.category_id,
        count: idx >= 0 ? (existing[idx].count || 1) + 1 : 1,
        lastUsed: new Date().toISOString(),
      }
      if (idx >= 0) existing[idx] = entry
      else existing.push(entry)
      try { localStorage.setItem('trolley_history', JSON.stringify(existing)) } catch {}
      return existing
    })
  }

  async function loadAndSubscribe(code) {
    channelRef.current?.unsubscribe()

    const cached = getCachedItems(code)
    if (cached.length > 0) setItems(cached)

    if (!navigator.onLine) return

    await flushQueue()

    const { data } = await supabase
      .from('list_items').select('*').eq('list_code', code).order('created_at', { ascending: true })

    if (data) {
      setItems(data)
      setCachedItems(code, data)
    }

    channelRef.current = supabase
      .channel(`list:${code}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'list_items' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            if (payload.new.list_code !== code) return
            if (itemsRef.current.some(i => i.id === payload.new.id)) return
            setItems(prev => {
              if (prev.some(i => i.id === payload.new.id)) return prev
              const next = [...prev, payload.new]
              setCachedItems(code, next)
              return next
            })
            if (!locallyAddedIdsRef.current.has(payload.new.id)) {
              markEntering(payload.new.id)
            }
          }
          if (payload.eventType === 'UPDATE') {
            if (payload.new.list_code !== code) return
            setItems(prev => {
              const next = prev.map(i => i.id === payload.new.id ? payload.new : i)
              setCachedItems(code, next)
              return next
            })
          }
          if (payload.eventType === 'DELETE') {
            const id = payload.old.id
            setExitingIds(prev => new Set([...prev, id]))
            setTimeout(() => {
              setExitingIds(prev => { const s = new Set(prev); s.delete(id); return s })
              setItems(prev => {
                const next = prev.filter(i => i.id !== id)
                setCachedItems(code, next)
                return next
              })
            }, 260)
          }
        })
      .subscribe()
  }

  async function joinList(e) {
    e.preventDefault()
    const code = inputCode.trim().toUpperCase()
    if (!code) return
    localStorage.setItem('trolley_code', code)
    listCodeRef.current = code
    setListCode(code)
    await loadAndSubscribe(code)
    setInputCode('')
  }

  async function createList() {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase()
    if (navigator.onLine) await supabase.from('lists').insert({ code })
    localStorage.setItem('trolley_code', code)
    listCodeRef.current = code
    setListCode(code)
    await loadAndSubscribe(code)
  }

  function handleInputChange(e) {
    const value = e.target.value
    setInput(value)
    const { qty, name: cleanName } = parseInputQty(value)
    setInputQty(qty)
    if (cleanName.length < 2) { setSuggestions([]); return }
    const search = cleanName.toLowerCase()
    const customMatches = getCustomProducts().filter(p => p.name.toLowerCase().includes(search))
    const customNames = new Set(customMatches.map(p => p.name.toLowerCase()))
    const builtInMatches = products.products
      .filter(p => !customNames.has(p.name.toLowerCase()))
      .filter(p => p.name.toLowerCase().includes(search) || p.keywords.some(k => k.includes(search)))
    setSuggestions([...customMatches, ...builtInMatches].slice(0, 8))
  }

  async function handleKeyDown(e) {
    if (e.key === 'Enter' && input.trim()) {
      if (suggestions.length > 0) await addItem(suggestions[0])
      else await addCustomItem(input.trim())
    }
    if (e.key === 'Escape') setSuggestions([])
  }

  async function addItem(product) {
    haptic(15)
    const id = crypto.randomUUID()
    const storedName = inputQty ? `${inputQty} ${product.name}` : product.name
    const category = products.categories.find(c => c.id === product.category)
    const newItem = {
      id,
      list_code: listCode,
      name: storedName,
      category: category?.name ?? 'Other',
      category_id: product.category,
      checked: false,
      created_at: new Date().toISOString(),
    }
    setItems(prev => { const next = [...prev, newItem]; setCachedItems(listCode, next); return next })
    locallyAddedIdsRef.current.add(id)
    markEntering(id)
    setInput(''); setInputQty(null); setSuggestions([]); inputRef.current?.focus()
    if (navigator.onLine) {
      await supabase.from('list_items').upsert(newItem, { onConflict: 'id' })
    } else {
      enqueue({ type: 'INSERT', data: newItem })
    }
  }

  async function addCustomItem(rawName) {
    haptic(15)
    const { qty, name: cleanName } = parseInputQty(rawName)
    const storedName = qty
      ? `${qty} ${cleanName.charAt(0).toUpperCase() + cleanName.slice(1)}`
      : rawName
    const isBuiltIn = products.products.some(p => p.name.toLowerCase() === cleanName.toLowerCase())
    if (!isBuiltIn) upsertCustomProduct(storedName, 'other')
    const id = crypto.randomUUID()
    const newItem = {
      id,
      list_code: listCode,
      name: storedName,
      category: 'Other',
      category_id: 'other',
      checked: false,
      created_at: new Date().toISOString(),
    }
    setItems(prev => { const next = [...prev, newItem]; setCachedItems(listCode, next); return next })
    locallyAddedIdsRef.current.add(id)
    markEntering(id)
    setInput(''); setInputQty(null); setSuggestions([]); inputRef.current?.focus()
    if (navigator.onLine) {
      await supabase.from('list_items').upsert(newItem, { onConflict: 'id' })
    } else {
      enqueue({ type: 'INSERT', data: newItem })
    }
  }

  async function addFromHistory(histItem) {
    haptic(15)
    const cat = products.categories.find(c => c.id === histItem.category_id)
    const id = crypto.randomUUID()
    const newItem = {
      id,
      list_code: listCode,
      name: histItem.name,
      category: cat?.name ?? 'Other',
      category_id: histItem.category_id ?? 'other',
      checked: false,
      created_at: new Date().toISOString(),
    }
    setItems(prev => { const next = [...prev, newItem]; setCachedItems(listCode, next); return next })
    locallyAddedIdsRef.current.add(id)
    markEntering(id)
    if (navigator.onLine) {
      await supabase.from('list_items').upsert(newItem, { onConflict: 'id' })
    } else {
      enqueue({ type: 'INSERT', data: newItem })
    }
  }

  async function toggleItem(id, checked) {
    haptic(checked ? 8 : [10, 30, 10])
    setItems(prev => { const next = prev.map(i => i.id === id ? { ...i, checked: !checked } : i); setCachedItems(listCode, next); return next })
    if (navigator.onLine) {
      await supabase.from('list_items').update({ checked: !checked }).eq('id', id)
    } else {
      enqueue({ type: 'UPDATE', id, data: { checked: !checked } })
    }
  }

  async function deleteItem(id) {
    haptic([10, 50, 20])
    const item = items.find(i => i.id === id)
    if (item) recordHistory(item)
    setItems(prev => { const next = prev.filter(i => i.id !== id); setCachedItems(listCode, next); return next })
    if (navigator.onLine) {
      await supabase.from('list_items').delete().eq('id', id)
    } else {
      enqueue({ type: 'DELETE', id })
    }
  }

  async function clearChecked() {
    const checkedItems = items.filter(i => i.checked)
    if (!checkedItems.length) return
    checkedItems.forEach(i => recordHistory(i))
    const ids = checkedItems.map(i => i.id)
    setExitingIds(prev => new Set([...prev, ...ids]))
    setTimeout(() => {
      setExitingIds(prev => { const s = new Set(prev); ids.forEach(id => s.delete(id)); return s })
      setItems(prev => { const next = prev.filter(i => !ids.includes(i.id)); setCachedItems(listCode, next); return next })
    }, 260)
    if (navigator.onLine) {
      await supabase.from('list_items').delete().in('id', ids)
    } else {
      ids.forEach(id => enqueue({ type: 'DELETE', id }))
    }
  }

  async function changeCategory(itemId, newCatId) {
    const cat = products.categories.find(c => c.id === newCatId)
    const update = { category: cat.name, category_id: newCatId }
    const item = items.find(i => i.id === itemId)
    if (item) upsertCustomProduct(item.name, newCatId)
    setItems(prev => { const next = prev.map(i => i.id === itemId ? { ...i, ...update } : i); setCachedItems(listCode, next); return next })
    setPickerItem(null)
    if (navigator.onLine) {
      await supabase.from('list_items').update(update).eq('id', itemId)
    } else {
      enqueue({ type: 'UPDATE', id: itemId, data: update })
    }
  }

  function leaveList() {
    channelRef.current?.unsubscribe()
    localStorage.removeItem('trolley_code')
    listCodeRef.current = null
    setListCode(null); setItems([]); setInput(''); setSuggestions([])
  }

  const getCat = (id) => products.categories.find(c => c.id === id)

  const orderedCats = categoryOrder.map(id => getCat(id)).filter(Boolean)
  const grouped = orderedCats
    .map(cat => ({ category: cat, items: items.filter(i => i.category_id === cat.id && !i.checked) }))
    .filter(g => g.items.length > 0)

  const checkedCount = items.filter(i => i.checked).length
  const checkedGrouped = orderedCats
    .map(cat => ({ category: cat, items: items.filter(i => i.category_id === cat.id && i.checked) }))
    .filter(g => g.items.length > 0)

  const filteredHistory = history
    .filter(h => !historySearch || h.name.toLowerCase().includes(historySearch.toLowerCase()))
    .sort((a, b) => (b.count || 1) - (a.count || 1))

  function renderItem(item) {
    return (
      <SwipeItem
        key={item.id}
        item={item}
        onToggle={toggleItem}
        onDelete={deleteItem}
        onPick={setPickerItem}
        getCat={getCat}
        lastTapRef={lastTapRef}
        isEntering={enteringIds.has(item.id)}
        isExiting={exitingIds.has(item.id)}
        animEnabled={animEnabled}
      />
    )
  }

  if (!listCode) {
    return (
      <div className="join-screen">
        <div className="join-logo">🛒</div>
        <h1>Trolley</h1>
        <p className="join-subtitle">Shared shopping lists, synced instantly</p>
        <div className="join-container">
          <button onClick={createList} className="create-btn">Create New List</button>
          <div className="divider"><span>or join existing</span></div>
          <form onSubmit={joinList} className="join-form">
            <input
              type="text" placeholder="Enter 6-letter code" value={inputCode}
              onChange={e => setInputCode(e.target.value.toUpperCase())}
              maxLength="6" className="code-input" autoCapitalize="characters" autoComplete="off"
            />
            <button type="submit">Join</button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header>
        <div className="header-left" onClick={() => window.location.reload()}>
          <span className="logo">🛒</span>
          <div className="header-title">
            <h1>Trolley</h1>
            <p className="version">v{VERSION}</p>
          </div>
        </div>
        <div className="header-right">
          {!online && <span className="offline-badge">Offline</span>}
          <button onClick={openSettings} className="icon-btn" aria-label="Settings">⚙️</button>
        </div>
      </header>

      {tab === 'list' ? (
        <>
          <div className="input-section">
            <input
              ref={inputRef} type="text" placeholder="Add item..." value={input}
              onChange={handleInputChange} onKeyDown={handleKeyDown}
              className="item-input" autoComplete="off"
            />
            {suggestions.length > 0 && (
              <div className="suggestions">
                {suggestions.map(p => (
                  <button key={p.name} onClick={() => addItem(p)} className="suggestion-item">
                    <span className="suggestion-name">
                      {inputQty && <span className="suggestion-qty">{inputQty} </span>}
                      {p.name}
                    </span>
                    <span className="suggestion-cat">
                      {getCat(p.category)?.icon} {getCat(p.category)?.name}
                    </span>
                  </button>
                ))}
                {input.trim() && (
                  <button onClick={() => addCustomItem(input.trim())} className="suggestion-item suggestion-custom">
                    <span className="suggestion-name">Add &ldquo;{input.trim()}&rdquo;</span>
                    <span className="suggestion-cat">🛍️ Other</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {items.length === 0 ? (
            <div className="empty-state">
              <p>Your list is empty</p>
              <p className="empty-hint">Start typing above to add items</p>
            </div>
          ) : (
            <>
              <div className="items-container">
                {grouped.map(({ category, items: catItems }) => (
                  <section key={category.id} className="category-section" style={{ '--cat-color': category.color }}>
                    <h2 className="category-heading">
                      <span className="cat-icon">{category.icon}</span>
                      {category.name}
                      <span className="cat-count">{catItems.length}</span>
                    </h2>
                    <ul>{catItems.map(renderItem)}</ul>
                  </section>
                ))}
              </div>

              {checkedCount > 0 && (
                <>
                  <button onClick={clearChecked} className="clear-btn">
                    Clear {checkedCount} checked item{checkedCount !== 1 ? 's' : ''}
                  </button>
                  <div className="checked-container">
                    {checkedGrouped.map(({ category, items: catItems }) => (
                      <section key={category.id} className="category-section checked-section" style={{ '--cat-color': category.color }}>
                        <h2 className="category-heading">
                          <span className="cat-icon">{category.icon}</span>
                          {category.name}
                          <span className="cat-count">{catItems.length}</span>
                        </h2>
                        <ul>{catItems.map(renderItem)}</ul>
                      </section>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div className="input-section">
            <input
              type="text" placeholder="Search history..." value={historySearch}
              onChange={e => setHistorySearch(e.target.value)}
              className="item-input" autoComplete="off"
            />
          </div>

          {filteredHistory.length === 0 ? (
            <div className="empty-state">
              <p>{historySearch ? 'No matching items' : 'No history yet'}</p>
              <p className="empty-hint">
                {historySearch ? 'Try a different search' : 'Items you tick off or delete will appear here'}
              </p>
            </div>
          ) : (
            <ul className="history-list">
              {filteredHistory.map(h => {
                const cat = getCat(h.category_id)
                const onList = items.some(i => i.name.toLowerCase() === h.name.toLowerCase() && !i.checked)
                return (
                  <li key={h.name} className={`history-item${onList ? ' on-list' : ''}`}>
                    <span className="history-cat-icon">{cat?.icon ?? '🛍️'}</span>
                    <span className="history-name">{h.name}</span>
                    <span className="history-meta">{h.count > 1 ? `×${h.count}` : ''}</span>
                    {onList ? (
                      <span className="history-on-list-badge">On list</span>
                    ) : (
                      <button className="history-add-btn" onClick={() => addFromHistory(h)}>+</button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      {pickerItem && (
        <div className="overlay" onClick={() => setPickerItem(null)}>
          <BottomSheet onClose={() => setPickerItem(null)}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <div>
                <p className="sheet-label">Change category</p>
                <p className="sheet-title">{pickerItem.name}</p>
              </div>
              <button onClick={() => setPickerItem(null)} className="sheet-close">✕</button>
            </div>
            <div className="sheet-body">
              {products.categories.map(cat => (
                <button
                  key={cat.id}
                  className={`cat-option${pickerItem.category_id === cat.id ? ' active' : ''}`}
                  onClick={() => changeCategory(pickerItem.id, cat.id)}
                >
                  <span className="cat-option-icon">{cat.icon}</span>
                  <span className="cat-option-name">{cat.name}</span>
                  {pickerItem.category_id === cat.id && <span className="cat-option-check">✓</span>}
                </button>
              ))}
            </div>
          </BottomSheet>
        </div>
      )}

      {settingsOpen && (
        <div className="overlay" onClick={closeSettings}>
          <BottomSheet onClose={closeSettings}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {settingsView !== 'main' && (
                  <button className="sheet-back" onClick={() => setSettingsView('main')}>‹</button>
                )}
                <p className="sheet-title">
                  {settingsView === 'main' ? 'Settings'
                    : settingsView === 'list' ? 'List Code'
                    : 'Manage Categories'}
                </p>
              </div>
              <button onClick={closeSettings} className="sheet-close">✕</button>
            </div>

            <div className="sheet-body">
              {settingsView === 'main' && (
                <>
                  <div className="settings-row">
                    <span className="settings-row-label">Appearance</span>
                    <button className="theme-toggle-btn" onClick={toggleTheme}>
                      {theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode'}
                    </button>
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">Animations</span>
                    <button className="theme-toggle-btn" onClick={() => setAnimEnabled(v => !v)}>
                      {animEnabled ? '✨ On' : '⚡ Off'}
                    </button>
                  </div>
                  <button className="settings-nav-item" onClick={() => setSettingsView('list')}>
                    <div className="settings-nav-left">
                      <span className="settings-nav-title">List Code</span>
                      <span className="settings-nav-sub">{listCode}</span>
                    </div>
                    <span className="settings-nav-arrow">›</span>
                  </button>
                  <button className="settings-nav-item" onClick={() => setSettingsView('categories')}>
                    <div className="settings-nav-left">
                      <span className="settings-nav-title">Manage Categories</span>
                      <span className="settings-nav-sub" style={{ fontFamily: 'inherit', letterSpacing: 0 }}>
                        Drag to reorder
                      </span>
                    </div>
                    <span className="settings-nav-arrow">›</span>
                  </button>
                </>
              )}

              {settingsView === 'list' && (
                <>
                  <div className="list-code-card">
                    <p className="list-code-big">{listCode}</p>
                    <p className="list-code-hint">Share this code with your partner</p>
                  </div>
                  <p className="settings-divider-label">Join another list</p>
                  <div className="settings-join-row">
                    <input
                      type="text" placeholder="Enter 6-letter code"
                      value={settingsJoinCode}
                      onChange={e => setSettingsJoinCode(e.target.value.toUpperCase())}
                      maxLength="6" className="settings-join-input"
                      autoCapitalize="characters" autoComplete="off"
                    />
                    <button className="settings-join-btn" onClick={() => switchList(settingsJoinCode)}>
                      Join
                    </button>
                  </div>
                  <button
                    className="settings-create-btn"
                    onClick={async () => { closeSettings(); await createList() }}
                  >
                    + Create new list
                  </button>
                  <p className="settings-divider-label">Leave</p>
                  <button
                    className="settings-action-btn danger"
                    onClick={() => { leaveList(); closeSettings() }}
                  >
                    Leave this list
                  </button>
                </>
              )}

              {settingsView === 'categories' && (
                <>
                  <p className="settings-section-label">Category Order</p>
                  <p className="settings-hint">Hold and drag to match your store layout</p>
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={categoryOrder} strategy={verticalListSortingStrategy}>
                      <ul className="cat-order-list">
                        {categoryOrder.map(catId => {
                          const cat = getCat(catId)
                          return cat ? <SortableCatItem key={catId} id={catId} cat={cat} /> : null
                        })}
                      </ul>
                    </SortableContext>
                  </DndContext>
                </>
              )}
            </div>
          </BottomSheet>
        </div>
      )}

      <nav className="tab-bar">
        <button className={`tab-btn${tab === 'list' ? ' active' : ''}`} onClick={() => setTab('list')}>
          <span className="tab-icon">🛒</span>
          <span className="tab-label">List</span>
        </button>
        <button className={`tab-btn${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>
          <span className="tab-icon">🕐</span>
          <span className="tab-label">History</span>
        </button>
      </nav>
    </div>
  )
}
