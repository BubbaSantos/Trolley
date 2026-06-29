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

const VERSION = '2.9.1'
const SNAP = 80
const AUTO = 220
const QUEUE_KEY = 'trolley_queue'
const PRESET_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#6366f1', '#a855f7', '#ec4899', '#94a3b8', '#78716c']

const COMMON_ITEMS = [
  { name: 'Milk Semi Skimmed',  category: 'milk-cheese' },
  { name: 'Eggs',               category: 'milk-cheese' },
  { name: 'Bread White',        category: 'bakery' },
  { name: 'Butter',             category: 'milk-cheese' },
  { name: 'Cheddar Cheese',     category: 'milk-cheese' },
  { name: 'Chicken Breast',     category: 'meat' },
  { name: 'Beef Mince',         category: 'meat' },
  { name: 'Bananas',            category: 'fresh-fruit' },
  { name: 'Apples',             category: 'fresh-fruit' },
  { name: 'Potatoes',           category: 'fresh-fruit' },
  { name: 'Onions',             category: 'fresh-fruit' },
  { name: 'Garlic',             category: 'fresh-fruit' },
  { name: 'Tomatoes',           category: 'fresh-fruit' },
  { name: 'Carrots',            category: 'fresh-fruit' },
  { name: 'Broccoli',           category: 'fresh-fruit' },
  { name: 'Spinach',            category: 'fresh-fruit' },
  { name: 'Pasta',              category: 'tins' },
  { name: 'Rice Basmati',       category: 'tins' },
  { name: 'Chopped Tomatoes',   category: 'tins' },
  { name: 'Baked Beans',        category: 'tins' },
  { name: 'Oil Olive',          category: 'tins' },
  { name: 'Tea Bags',           category: 'drinks' },
  { name: 'Coffee Instant',     category: 'drinks' },
  { name: 'Orange Juice',       category: 'drinks' },
  { name: 'Yoghurt Natural',    category: 'milk-cheese' },
  { name: 'Sausages',           category: 'meat' },
  { name: 'Salmon Fillet',      category: 'meat' },
  { name: 'Toilet Paper',       category: 'household' },
  { name: 'Washing Up Liquid',  category: 'household' },
  { name: 'Laundry Capsules',   category: 'household' },
  { name: 'Bin Bags',           category: 'household' },
  { name: 'Kitchen Roll',       category: 'household' },
  { name: 'Cereal',             category: 'tins' },
  { name: 'Bread Wholemeal',    category: 'bakery' },
  { name: 'Lettuce',            category: 'fresh-fruit' },
  { name: 'Cucumbers',          category: 'fresh-fruit' },
  { name: 'Mushrooms',          category: 'fresh-fruit' },
  { name: 'Frozen Peas',        category: 'frozen' },
  { name: 'Toothpaste',         category: 'other' },
  { name: 'Shampoo',            category: 'other' },
]

function getCachedItems(code) {
  try { return JSON.parse(localStorage.getItem(`trolley_items_${code}`) || '[]') } catch { return [] }
}
function setCachedItems(code, items) {
  try { localStorage.setItem(`trolley_items_${code}`, JSON.stringify(items)) } catch {}
}
function getQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') } catch { return [] }
}
function saveQueue(q) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)) } catch {} }
function enqueue(op) { const q = getQueue(); q.push(op); saveQueue(q) }

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

function getCustomCategories() {
  try { return JSON.parse(localStorage.getItem('trolley_custom_cats') || '[]') } catch { return [] }
}
function saveCustomCategories(cats) {
  try { localStorage.setItem('trolley_custom_cats', JSON.stringify(cats)) } catch {}
}

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

function parseItemName(stored) {
  let m = stored.match(/^(\d+x)\s+(.+)$/i)
  if (m) return { qty: m[1], name: m[2] }
  m = stored.match(/^(\d+(?:\.\d+)?(?:kg|g|ml|l|lbs?|oz))\s+(.+)$/i)
  if (m) return { qty: m[1], name: m[2] }
  return { qty: null, name: stored }
}

function haptic(pattern = 10) { try { navigator.vibrate?.(pattern) } catch {} }

function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return online
}

function SwipeItem({ item, onToggle, onDelete, onInfo, lastTapRef, isEntering, isExiting, isStriking }) {
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
      startX = e.touches[0].clientX; startY = e.touches[0].clientY
      dir = null; baseX = txRef.current; setAnimate(false)
    }
    function onMove(e) {
      const dx = e.touches[0].clientX - startX, dy = e.touches[0].clientY - startY
      if (!dir) { if (Math.abs(dx) > 5 || Math.abs(dy) > 5) dir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'; return }
      if (dir !== 'h') return
      e.preventDefault()
      setTx(Math.min(0, Math.max(-(AUTO + 20), baseX + dx)))
    }
    function onEnd() {
      if (dir !== 'h') return
      setAnimate(true)
      const t = txRef.current
      if (t < -AUTO) { setTx(-window.innerWidth); setTimeout(() => onDeleteRef.current(item.id), 260) }
      else if (t < -(SNAP / 2)) setTx(-SNAP)
      else setTx(0)
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
    const now = Date.now(), last = lastTapRef.current[item.id] || 0
    if (now - last < 400) { lastTapRef.current[item.id] = 0; onToggle(item.id, item.checked) }
    else lastTapRef.current[item.id] = now
  }

  const { qty, name: displayName } = parseItemName(item.name)
  const displayQty = qty
    ? (qty.match(/^(\d+)x$/i) ? `x${qty.match(/^(\d+)/)[1]}` : qty)
    : null

  return (
    <div className={`item-row-outer${isEntering ? ' item-enter' : ''}${isExiting ? ' item-exit' : ''}`}>
      <div className="swipe-wrapper">
        <div className="swipe-bg">
          <button className="swipe-delete-btn" onClick={() => {
            setAnimate(true); setTx(-window.innerWidth)
            setTimeout(() => onDeleteRef.current(item.id), 260)
          }}>Delete</button>
        </div>
        <div
          ref={rowRef}
          className={`swipe-row${animate ? ' animate' : ''}${item.checked ? ' checked' : ''}${isStriking ? ' striking' : ''}`}
          style={{ transform: `translateX(${tx}px)` }}
          onClick={handleClick}
        >
          <button
            className={`check-btn${item.checked || isStriking ? ' checked-btn' : ''}`}
            onClick={e => { e.stopPropagation(); onToggle(item.id, item.checked) }}
          >
            <span className="checkmark">{item.checked || isStriking ? '✓' : ''}</span>
          </button>
          <span className="item-name-group">
            {displayName}{displayQty && <span className="item-qty">{displayQty}</span>}
          </span>
          <button className="info-btn" onClick={e => { e.stopPropagation(); onInfo(item) }} aria-label="Item details" />
        </div>
      </div>
    </div>
  )
}

function SwipeHistoryItem({ h, onAdd, onDelete, onList }) {
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
    function onStart(e) { startX = e.touches[0].clientX; startY = e.touches[0].clientY; dir = null; baseX = txRef.current; setAnimate(false) }
    function onMove(e) {
      const dx = e.touches[0].clientX - startX, dy = e.touches[0].clientY - startY
      if (!dir) { if (Math.abs(dx) > 5 || Math.abs(dy) > 5) dir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'; return }
      if (dir !== 'h') return
      e.preventDefault()
      setTx(Math.min(0, Math.max(-(AUTO + 20), baseX + dx)))
    }
    function onEnd() {
      if (dir !== 'h') return
      setAnimate(true)
      const t = txRef.current
      if (t < -AUTO) { setTx(-window.innerWidth); setTimeout(() => onDeleteRef.current(h.name), 260) }
      else if (t < -(SNAP / 2)) setTx(-SNAP)
      else setTx(0)
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    return () => { el.removeEventListener('touchstart', onStart); el.removeEventListener('touchmove', onMove); el.removeEventListener('touchend', onEnd) }
  }, [h.name])

  return (
    <li className={`history-item${onList ? ' on-list' : ''}`}>
      <div className="swipe-wrapper">
        <div className="swipe-bg">
          <button className="swipe-delete-btn" onClick={() => { setAnimate(true); setTx(-window.innerWidth); setTimeout(() => onDeleteRef.current(h.name), 260) }}>Delete</button>
        </div>
        <div ref={rowRef} className={`history-item-row${animate ? ' animate' : ''}`} style={{ transform: `translateX(${tx}px)` }}>
          <span className="history-name">{h.name}</span>
          {h.is_favourite && <span className="history-fav">★</span>}
          {onList ? <span className="history-on-list-badge">On list</span>
            : <button className="history-add-btn" onClick={() => { if (txRef.current !== 0) { setAnimate(true); setTx(0) } else onAdd(h) }}>+</button>}
        </div>
      </div>
    </li>
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

function BottomSheet({ onClose, children }) {
  const sheetRef = useRef(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    const el = sheetRef.current
    if (!el) return
    let startY = 0, startTime = 0, currentY = 0, engaged = false

    function onStart(e) {
      startY = e.touches[0].clientY; startTime = Date.now()
      currentY = 0; engaged = false; el.style.transition = 'none'
    }
    function onMove(e) {
      const dy = e.touches[0].clientY - startY
      if (dy <= 0) { engaged = false; return }
      const bodyEl = el.querySelector('.sheet-body')
      if (!engaged && bodyEl && bodyEl.scrollTop > 0) return
      engaged = true; currentY = dy
      el.style.transform = `translateY(${dy}px)`
      e.preventDefault()
    }
    function onEnd() {
      if (!engaged) { el.style.transition = ''; return }
      const velocity = currentY / (Date.now() - startTime)
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

  return <div ref={sheetRef} className="sheet" onClick={e => e.stopPropagation()}>{children}</div>
}

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)

async function flushQueue() {
  const q = getQueue(); if (!q.length) return
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
  const customCats = getCustomCategories()
  const allIds = [...products.categories.map(c => c.id), ...customCats.map(c => c.id)]
  try {
    const saved = localStorage.getItem('trolley_cat_order')
    if (saved) {
      const parsed = JSON.parse(saved)
      const missing = allIds.filter(id => !parsed.includes(id))
      return [...parsed, ...missing]
    }
  } catch {}
  return allIds
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
  const [pendingItemData, setPendingItemData] = useState(null)
  const [detailItem, setDetailItem] = useState(null)
  const [detailName, setDetailName] = useState('')
  const [detailQty, setDetailQty] = useState(1)
  const [detailQtyText, setDetailQtyText] = useState('')
  const [detailQtyIsText, setDetailQtyIsText] = useState(false)
  const [categoryOrder, setCategoryOrder] = useState(loadCategoryOrder)
  const [customCategories, setCustomCategories] = useState(getCustomCategories)
  const [tab, setTab] = useState('list')
  const [historySearch, setHistorySearch] = useState('')
  const [history, setHistory] = useState([])
  const [confirming, setConfirming] = useState(null)
  const confirmTimerRef = useRef(null)
  const [settingsView, setSettingsView] = useState('main')
  const [settingsJoinCode, setSettingsJoinCode] = useState('')
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatIcon, setNewCatIcon] = useState('')
  const [newCatColor, setNewCatColor] = useState(PRESET_COLORS[5])
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('trolley_theme') || 'dark'
    document.documentElement.setAttribute('data-theme', saved)
    return saved
  })
  const [enteringIds, setEnteringIds] = useState(() => new Set())
  const [exitingIds, setExitingIds] = useState(() => new Set())
  const [strikingIds, setStrikingIds] = useState(() => new Set())

  const inputRef = useRef(null)
  const channelRef = useRef(null)
  const lastTapRef = useRef({})
  const listCodeRef = useRef(null)
  const locallyAddedIdsRef = useRef(new Set())
  const itemsRef = useRef([])
  const historyRef = useRef([])
  const keepSuggestionsRef = useRef(false)
  const strikeTimerRef = useRef({})
  const online = useOnlineStatus()
  const prevOnlineRef = useRef(true)

  useEffect(() => { itemsRef.current = items }, [items])
  useEffect(() => { historyRef.current = history }, [history])

  const allCategories = [...products.categories, ...customCategories]
  const getCat = (id) => allCategories.find(c => c.id === id)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd({ active, over }) {
    if (over && active.id !== over.id) {
      setCategoryOrder(prev => {
        const oldIndex = prev.indexOf(active.id), newIndex = prev.indexOf(over.id)
        return arrayMove(prev, oldIndex, newIndex)
      })
    }
  }

  useEffect(() => {
    const saved = localStorage.getItem('trolley_code')
    if (saved) { setListCode(saved); listCodeRef.current = saved; loadAndSubscribe(saved) }
    return () => channelRef.current?.unsubscribe()
  }, [])

  useEffect(() => { localStorage.setItem('trolley_cat_order', JSON.stringify(categoryOrder)) }, [categoryOrder])
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); localStorage.setItem('trolley_theme', theme) }, [theme])

  function toggleTheme() { setTheme(t => t === 'dark' ? 'light' : 'dark') }

  function markEntering(id) {
    setEnteringIds(prev => new Set([...prev, id]))
    setTimeout(() => setEnteringIds(prev => { const s = new Set(prev); s.delete(id); return s }), 400)
  }

  function openSettings() { setSettingsView('main'); setSettingsOpen(true) }
  function closeSettings() {
    setSettingsOpen(false); setSettingsView('main'); setSettingsJoinCode(''); setAddingCategory(false)
    setConfirming(null); clearTimeout(confirmTimerRef.current)
  }

  function requestConfirm(key) {
    if (confirming === key) return
    clearTimeout(confirmTimerRef.current)
    setConfirming(key)
    confirmTimerRef.current = setTimeout(() => setConfirming(null), 4000)
  }

  async function switchList(code) {
    const clean = code.trim().toUpperCase()
    if (!clean) return
    closeSettings()
    localStorage.setItem('trolley_code', clean); listCodeRef.current = clean; setListCode(clean)
    await loadAndSubscribe(clean)
  }

  useEffect(() => {
    if (online && !prevOnlineRef.current && listCodeRef.current) loadAndSubscribe(listCodeRef.current)
    prevOnlineRef.current = online
  }, [online])

  async function recordHistory(item) {
    const { name: cleanName } = parseItemName(item.name)
    const current = historyRef.current.find(h => h.name.toLowerCase() === cleanName.toLowerCase())
    const newEntry = {
      list_code: listCodeRef.current,
      name: cleanName,
      category_id: item.category_id,
      count: (current?.count || 0) + 1,
      last_used: new Date().toISOString(),
      is_favourite: current?.is_favourite || false,
    }
    setHistory(prev => {
      const idx = prev.findIndex(h => h.name.toLowerCase() === cleanName.toLowerCase())
      const next = [...prev]
      if (idx >= 0) next[idx] = newEntry; else next.push(newEntry)
      return next
    })
    if (navigator.onLine) {
      await supabase.from('list_history').upsert(newEntry, { onConflict: 'list_code,name' })
    }
  }

  async function toggleFavourite(itemName) {
    const { name: cleanName } = parseItemName(itemName)
    const current = history.find(h => h.name.toLowerCase() === cleanName.toLowerCase())
    const isFav = !(current?.is_favourite || false)
    const entry = {
      list_code: listCode,
      name: current?.name || cleanName,
      category_id: current?.category_id || 'other',
      count: current?.count || 0,
      last_used: current?.last_used || new Date().toISOString(),
      is_favourite: isFav,
    }
    setHistory(prev => {
      const idx = prev.findIndex(h => h.name.toLowerCase() === cleanName.toLowerCase())
      const next = [...prev]
      if (idx >= 0) next[idx] = { ...next[idx], is_favourite: isFav }
      else next.push(entry)
      return next
    })
    if (navigator.onLine) {
      await supabase.from('list_history').upsert(entry, { onConflict: 'list_code,name' })
    }
  }

  async function loadAndSubscribe(code) {
    channelRef.current?.unsubscribe()
    const cached = getCachedItems(code)
    if (cached.length > 0) setItems(cached)
    if (!navigator.onLine) return
    await flushQueue()
    const [{ data: itemData }, { data: histData }] = await Promise.all([
      supabase.from('list_items').select('*').eq('list_code', code).order('created_at', { ascending: true }),
      supabase.from('list_history').select('*').eq('list_code', code),
    ])
    if (itemData) { setItems(itemData); setCachedItems(code, itemData) }
    if (histData) setHistory(histData)

    channelRef.current = supabase
      .channel(`list:${code}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'list_items' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          if (payload.new.list_code !== code) return
          if (itemsRef.current.some(i => i.id === payload.new.id)) return
          setItems(prev => {
            if (prev.some(i => i.id === payload.new.id)) return prev
            const next = [...prev, payload.new]; setCachedItems(code, next); return next
          })
          if (!locallyAddedIdsRef.current.has(payload.new.id)) markEntering(payload.new.id)
        }
        if (payload.eventType === 'UPDATE') {
          if (payload.new.list_code !== code) return
          setItems(prev => { const next = prev.map(i => i.id === payload.new.id ? payload.new : i); setCachedItems(code, next); return next })
        }
        if (payload.eventType === 'DELETE') {
          const id = payload.old.id
          setExitingIds(prev => new Set([...prev, id]))
          setTimeout(() => {
            setExitingIds(prev => { const s = new Set(prev); s.delete(id); return s })
            setItems(prev => { const next = prev.filter(i => i.id !== id); setCachedItems(code, next); return next })
          }, 260)
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'list_history' }, (payload) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          if (payload.new.list_code !== code) return
          setHistory(prev => {
            const idx = prev.findIndex(h => h.name.toLowerCase() === payload.new.name.toLowerCase())
            if (idx >= 0) { const next = [...prev]; next[idx] = payload.new; return next }
            return [...prev, payload.new]
          })
        }
        if (payload.eventType === 'DELETE') {
          setHistory(prev => prev.filter(h => h.name !== payload.old.name))
        }
      })
      .subscribe()
  }

  async function joinList(e) {
    e.preventDefault()
    const code = inputCode.trim().toUpperCase()
    if (!code) return
    localStorage.setItem('trolley_code', code); listCodeRef.current = code; setListCode(code)
    await loadAndSubscribe(code); setInputCode('')
  }

  async function createList() {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase()
    if (navigator.onLine) await supabase.from('lists').insert({ code })
    localStorage.setItem('trolley_code', code); listCodeRef.current = code; setListCode(code)
    await loadAndSubscribe(code)
  }

  function getHistorySuggestions(exclude = []) {
    const onList = new Set([
      ...items.map(i => parseItemName(i.name).name.toLowerCase()),
      ...exclude.map(n => n.toLowerCase()),
    ])
    const histSugs = history
      .filter(h => !onList.has(h.name.toLowerCase()))
      .sort((a, b) => {
        if (a.is_favourite && !b.is_favourite) return -1
        if (!a.is_favourite && b.is_favourite) return 1
        return (b.count || 1) - (a.count || 1)
      })
      .slice(0, 5)
      .map(h => {
        const learned = getCustomProducts().find(p => p.name.toLowerCase() === h.name.toLowerCase())
        return { name: h.name, category: learned?.category || h.category_id || 'other', fromHistory: true, count: h.count || 1 }
      })
    if (histSugs.length >= 5) return histSugs
    const alreadyShown = new Set([...onList, ...histSugs.map(s => s.name.toLowerCase())])
    const fallback = COMMON_ITEMS
      .filter(item => !alreadyShown.has(item.name.toLowerCase()))
      .slice(0, 5 - histSugs.length)
      .map(item => ({ name: item.name, category: item.category, fromHistory: true, count: 0 }))
    return [...histSugs, ...fallback]
  }

  function handleInputFocus() {
    if (input.length >= 2) return
    if (suggestions.length > 0 && suggestions[0]?.fromHistory) return
    const sug = getHistorySuggestions()
    if (sug.length > 0) setSuggestions(sug)
  }

  function handleInputBlur() {
    setTimeout(() => {
      if (keepSuggestionsRef.current) { keepSuggestionsRef.current = false; return }
      setSuggestions([])
    }, 150)
  }

  function handleInputChange(e) {
    const value = e.target.value
    setInput(value)
    const { qty, name: cleanName } = parseInputQty(value)
    setInputQty(qty)
    if (cleanName.length < 2) { setSuggestions(getHistorySuggestions()); return }
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
      if (suggestions.length > 0 && !suggestions[0].fromHistory) await addItem(suggestions[0])
      else await addCustomItem(input.trim())
    }
    if (e.key === 'Escape') setSuggestions([])
  }

  async function doAddItem(newItem) {
    setItems(prev => { const next = [...prev, newItem]; setCachedItems(listCode, next); return next })
    locallyAddedIdsRef.current.add(newItem.id)
    markEntering(newItem.id)
    if (navigator.onLine) await supabase.from('list_items').upsert(newItem, { onConflict: 'id' })
    else enqueue({ type: 'INSERT', data: newItem })
  }

  async function addItem(product) {
    haptic(15)
    const id = crypto.randomUUID()
    const storedName = inputQty ? `${inputQty} ${product.name}` : product.name
    const catId = product.category || 'other'
    if (catId === 'other') {
      setPendingItemData({ id, list_code: listCode, name: storedName, category: 'Other', category_id: 'other', checked: false, created_at: new Date().toISOString() })
      setInput(''); setInputQty(null); setSuggestions([])
      return
    }
    const cat = allCategories.find(c => c.id === catId)
    const newItem = { id, list_code: listCode, name: storedName, category: cat?.name ?? 'Other', category_id: catId, checked: false, created_at: new Date().toISOString() }
    if (product.fromHistory) {
      keepSuggestionsRef.current = true
      const refreshed = getHistorySuggestions([product.name])
      setSuggestions(refreshed)
      setInput('')
      setInputQty(null)
      inputRef.current?.focus()
    } else {
      setInput(''); setInputQty(null); setSuggestions([]); inputRef.current?.focus()
    }
    await doAddItem(newItem)
  }

  async function addCustomItem(rawName) {
    haptic(15)
    const { qty, name: cleanName } = parseInputQty(rawName)
    const storedName = qty ? `${qty} ${cleanName.charAt(0).toUpperCase() + cleanName.slice(1)}` : rawName
    const learned = getCustomProducts().find(p => p.name.toLowerCase() === cleanName.toLowerCase() && p.category && p.category !== 'other')
    const id = crypto.randomUUID()
    if (!learned) {
      setPendingItemData({ id, list_code: listCode, name: storedName, category: 'Other', category_id: 'other', checked: false, created_at: new Date().toISOString() })
      setInput(''); setInputQty(null); setSuggestions([])
      return
    }
    const cat = allCategories.find(c => c.id === learned.category)
    const newItem = { id, list_code: listCode, name: storedName, category: cat?.name ?? 'Other', category_id: learned.category, checked: false, created_at: new Date().toISOString() }
    setInput(''); setInputQty(null); setSuggestions([]); inputRef.current?.focus()
    await doAddItem(newItem)
  }

  async function addFromHistory(histItem) {
    haptic(15)
    const id = crypto.randomUUID()
    if (!histItem.category_id || histItem.category_id === 'other') {
      setPendingItemData({ id, list_code: listCode, name: histItem.name, category: 'Other', category_id: 'other', checked: false, created_at: new Date().toISOString() })
      return
    }
    const cat = allCategories.find(c => c.id === histItem.category_id)
    await doAddItem({ id, list_code: listCode, name: histItem.name, category: cat?.name ?? 'Other', category_id: histItem.category_id, checked: false, created_at: new Date().toISOString() })
  }

  async function confirmItemCategory(catId) {
    if (!pendingItemData) return
    const cat = allCategories.find(c => c.id === catId)
    const newItem = { ...pendingItemData, category: cat?.name ?? 'Other', category_id: catId }
    const { name: cleanName } = parseItemName(newItem.name)
    upsertCustomProduct(cleanName, catId)
    setPendingItemData(null)
    await doAddItem(newItem)
  }

  async function addPendingUncategorised() {
    if (!pendingItemData) return
    const newItem = pendingItemData
    setPendingItemData(null)
    await doAddItem(newItem)
  }

  async function toggleItem(id, checked) {
    if (strikingIds.has(id)) {
      clearTimeout(strikeTimerRef.current[id])
      delete strikeTimerRef.current[id]
      setStrikingIds(prev => { const s = new Set(prev); s.delete(id); return s })
      return
    }
    haptic(checked ? 8 : [10, 30, 10])
    if (!checked) {
      setStrikingIds(prev => new Set([...prev, id]))
      strikeTimerRef.current[id] = setTimeout(async () => {
        delete strikeTimerRef.current[id]
        setStrikingIds(prev => { const s = new Set(prev); s.delete(id); return s })
        const now = Date.now()
        setItems(prev => { const next = prev.map(i => i.id === id ? { ...i, checked: true, checked_at: now } : i); setCachedItems(listCode, next); return next })
        if (navigator.onLine) await supabase.from('list_items').update({ checked: true }).eq('id', id)
        else enqueue({ type: 'UPDATE', id, data: { checked: true } })
      }, 2000)
    } else {
      setItems(prev => { const next = prev.map(i => i.id === id ? { ...i, checked: false, checked_at: null } : i); setCachedItems(listCode, next); return next })
      if (navigator.onLine) await supabase.from('list_items').update({ checked: false }).eq('id', id)
      else enqueue({ type: 'UPDATE', id, data: { checked: false } })
    }
  }

  async function deleteItem(id) {
    haptic([10, 50, 20])
    const item = items.find(i => i.id === id)
    if (item) recordHistory(item)
    setItems(prev => { const next = prev.filter(i => i.id !== id); setCachedItems(listCode, next); return next })
    if (navigator.onLine) await supabase.from('list_items').delete().eq('id', id)
    else enqueue({ type: 'DELETE', id })
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
    if (navigator.onLine) await supabase.from('list_items').delete().in('id', ids)
    else ids.forEach(id => enqueue({ type: 'DELETE', id }))
  }

  async function changeCategory(itemId, newCatId) {
    const cat = allCategories.find(c => c.id === newCatId)
    const update = { category: cat.name, category_id: newCatId }
    const item = items.find(i => i.id === itemId)
    if (item) upsertCustomProduct(item.name, newCatId)
    setItems(prev => { const next = prev.map(i => i.id === itemId ? { ...i, ...update } : i); setCachedItems(listCode, next); return next })
    setPickerItem(null)
    if (navigator.onLine) await supabase.from('list_items').update(update).eq('id', itemId)
    else enqueue({ type: 'UPDATE', id: itemId, data: update })
  }

  function leaveList() {
    channelRef.current?.unsubscribe()
    localStorage.removeItem('trolley_code'); listCodeRef.current = null
    setListCode(null); setItems([]); setHistory([]); setInput(''); setSuggestions([])
  }

  async function clearList() {
    const ids = items.map(i => i.id)
    if (!ids.length) { closeSettings(); return }
    setExitingIds(prev => new Set([...prev, ...ids]))
    setTimeout(() => {
      setExitingIds(prev => { const s = new Set(prev); ids.forEach(id => s.delete(id)); return s })
      setItems([]); setCachedItems(listCode, [])
    }, 300)
    closeSettings()
    if (navigator.onLine) await supabase.from('list_items').delete().eq('list_code', listCode)
    else ids.forEach(id => enqueue({ type: 'DELETE', id }))
  }

  async function clearHistory() {
    setHistory([])
    closeSettings()
    if (navigator.onLine) await supabase.from('list_history').delete().eq('list_code', listCode)
  }

  async function deleteHistoryItem(name) {
    setHistory(prev => prev.filter(h => h.name !== name))
    if (navigator.onLine) {
      await supabase.from('list_history').delete().eq('list_code', listCode).eq('name', name)
    }
  }

  // --- Item detail sheet ---
  function openDetail(item) {
    const { qty, name: baseName } = parseItemName(item.name)
    let numQty = 1, isTextQty = false, textQty = ''
    if (qty) {
      const m = qty.match(/^(\d+)x$/i)
      if (m) numQty = parseInt(m[1])
      else { isTextQty = true; textQty = qty }
    }
    setDetailName(baseName)
    setDetailQty(numQty)
    setDetailQtyIsText(isTextQty)
    setDetailQtyText(textQty)
    setDetailItem(item)
  }

  function buildDetailName() {
    const base = detailName.trim()
    if (!base) return null
    if (detailQtyIsText && detailQtyText.trim()) return `${detailQtyText.trim()} ${base}`
    if (!detailQtyIsText && detailQty > 1) return `${detailQty}x ${base}`
    return base
  }

  async function saveDetail() {
    if (!detailItem) return
    const newName = buildDetailName()
    if (!newName) return
    const update = { name: newName }
    setItems(prev => { const next = prev.map(i => i.id === detailItem.id ? { ...i, ...update } : i); setCachedItems(listCode, next); return next })
    setDetailItem(null)
    if (navigator.onLine) await supabase.from('list_items').update(update).eq('id', detailItem.id)
    else enqueue({ type: 'UPDATE', id: detailItem.id, data: update })

    const { name: oldBase } = parseItemName(detailItem.name)
    const { name: newBase } = parseItemName(newName)
    if (oldBase.toLowerCase() !== newBase.toLowerCase()) {
      const existing = history.find(h => h.name.toLowerCase() === oldBase.toLowerCase())
      if (existing) {
        const migrated = { ...existing, name: newBase }
        setHistory(prev => prev.map(h => h.name.toLowerCase() === oldBase.toLowerCase() ? migrated : h))
        if (navigator.onLine) {
          await supabase.from('list_history').delete().eq('list_code', listCode).eq('name', existing.name)
          await supabase.from('list_history').upsert(migrated, { onConflict: 'list_code,name' })
        }
      }
    }
  }

  function openDetailCategoryPicker() {
    if (!detailItem) return
    const newName = buildDetailName()
    const itemForPicker = newName ? { ...detailItem, name: newName } : detailItem
    if (newName && newName !== detailItem.name) {
      setItems(prev => { const next = prev.map(i => i.id === detailItem.id ? { ...i, name: newName } : i); setCachedItems(listCode, next); return next })
      if (navigator.onLine) supabase.from('list_items').update({ name: newName }).eq('id', detailItem.id).then(() => {})
      else enqueue({ type: 'UPDATE', id: detailItem.id, data: { name: newName } })
    }
    setDetailItem(null)
    setPickerItem(itemForPicker)
  }

  // --- Custom categories ---
  function saveNewCategory() {
    const name = newCatName.trim()
    if (!name) return
    const newCat = { id: `custom_${Date.now()}`, name, icon: newCatIcon.trim() || '📦', color: newCatColor }
    const updated = [...customCategories, newCat]
    setCustomCategories(updated); saveCustomCategories(updated)
    setCategoryOrder(prev => [...prev, newCat.id])
    setNewCatName(''); setNewCatIcon(''); setNewCatColor(PRESET_COLORS[5]); setAddingCategory(false)
  }

  const orderedCats = categoryOrder.map(id => getCat(id)).filter(Boolean)
  const grouped = orderedCats.map(cat => ({ category: cat, items: items.filter(i => i.category_id === cat.id && !i.checked) })).filter(g => g.items.length > 0)
  const checkedCount = items.filter(i => i.checked).length
  const checkedSorted = items.filter(i => i.checked).sort((a, b) => (b.checked_at || 0) - (a.checked_at || 0))
  const filteredHistory = history
    .filter(h => !historySearch || h.name.toLowerCase().includes(historySearch.toLowerCase()))
    .sort((a, b) => {
      if (a.is_favourite && !b.is_favourite) return -1
      if (!a.is_favourite && b.is_favourite) return 1
      return (b.count || 1) - (a.count || 1)
    })

  function renderItem(item) {
    return (
      <SwipeItem
        key={item.id} item={item} onToggle={toggleItem} onDelete={deleteItem}
        onInfo={openDetail} lastTapRef={lastTapRef}
        isEntering={enteringIds.has(item.id)} isExiting={exitingIds.has(item.id)}
        isStriking={strikingIds.has(item.id)}
      />
    )
  }

  const showingHistory = suggestions.length > 0 && !!suggestions[0]?.fromHistory

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
            <input type="text" placeholder="Enter 6-letter code" value={inputCode}
              onChange={e => setInputCode(e.target.value.toUpperCase())}
              maxLength="6" className="code-input" autoCapitalize="characters" autoComplete="off" />
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
              onFocus={handleInputFocus} onBlur={handleInputBlur}
              className="item-input" autoComplete="off"
            />
            {(suggestions.length > 0 || (input.trim() && suggestions.length === 0)) && (
              <div className="suggestions">
                {showingHistory && (
                  <p className="suggestions-header">
                    {suggestions.some(s => (s.count || 0) > 0) ? 'Frequently bought' : 'Suggestions'}
                  </p>
                )}
                {suggestions.map(p => (
                  <button key={p.name} onClick={() => addItem(p)} className="suggestion-item">
                    <span className="suggestion-name">
                      {inputQty && <span className="suggestion-qty">{inputQty} </span>}
                      {p.name}
                    </span>
                    <span className="suggestion-cat">
                      {getCat(p.category)?.icon ?? '🛍️'} {getCat(p.category)?.name ?? 'Other'}
                      {p.fromHistory && p.count > 1 && <span className="suggestion-count"> ×{p.count}</span>}
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
                    <ul>{checkedSorted.map(renderItem)}</ul>
                  </div>
                </>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div className="input-section">
            <input type="text" placeholder="Search history..." value={historySearch}
              onChange={e => setHistorySearch(e.target.value)} className="item-input" autoComplete="off" />
          </div>
          {filteredHistory.length === 0 ? (
            <div className="empty-state">
              <p>{historySearch ? 'No matching items' : 'No history yet'}</p>
              <p className="empty-hint">{historySearch ? 'Try a different search' : 'Items you tick off or delete will appear here'}</p>
            </div>
          ) : (
            <ul className="history-list">
              {filteredHistory.map(h => {
                const onList = items.some(i => parseItemName(i.name).name.toLowerCase() === h.name.toLowerCase() && !i.checked)
                return <SwipeHistoryItem key={h.name} h={h} onAdd={addFromHistory} onDelete={deleteHistoryItem} onList={onList} />
              })}
            </ul>
          )}
        </>
      )}

      {/* Item detail sheet */}
      {detailItem && (
        <div className="overlay" onClick={saveDetail}>
          <BottomSheet onClose={saveDetail}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <p className="sheet-title">{detailItem.name}</p>
              <button className="sheet-done-btn" onClick={saveDetail}>Done</button>
            </div>
            <div className="sheet-body">
              <div className="detail-card">
                <div className="detail-field">
                  <input
                    type="text" value={detailName} onChange={e => setDetailName(e.target.value)}
                    className="detail-name-input" placeholder="Item name"
                    autoComplete="off"
                  />
                </div>
                <div className="detail-divider" />
                <div className="detail-field detail-qty-row">
                  <span className="detail-field-label">How many?</span>
                  {detailQtyIsText ? (
                    <input type="text" value={detailQtyText} onChange={e => setDetailQtyText(e.target.value)}
                      className="detail-qty-text" />
                  ) : (
                    <div className="qty-stepper">
                      <button className="qty-btn" onClick={() => setDetailQty(q => Math.max(1, q - 1))}>−</button>
                      <span className="qty-value">{detailQty}</span>
                      <button className="qty-btn" onClick={() => setDetailQty(q => q + 1)}>+</button>
                    </div>
                  )}
                </div>
              </div>
              <button className="detail-cat-row" onClick={openDetailCategoryPicker}>
                <span className="detail-cat-label">Category</span>
                <span className="detail-cat-value">
                  {getCat(detailItem.category_id)?.icon ?? '🛍️'}
                  {getCat(detailItem.category_id)?.name ?? 'Other'}
                </span>
                <span className="detail-cat-arrow">›</span>
              </button>
              {(() => {
                const { name: cleanName } = parseItemName(detailItem.name)
                const isFav = history.some(h => h.name.toLowerCase() === cleanName.toLowerCase() && h.is_favourite)
                return (
                  <button className="detail-cat-row" onClick={() => toggleFavourite(detailItem.name)}>
                    <span className="detail-cat-label">Favourite</span>
                    <span className={`detail-fav-toggle${isFav ? ' active' : ''}`}>{isFav ? '★' : '☆'}</span>
                  </button>
                )
              })()}
            </div>
          </BottomSheet>
        </div>
      )}

      {/* Category picker */}
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
              {allCategories.map(cat => (
                <button key={cat.id} className={`cat-option${pickerItem.category_id === cat.id ? ' active' : ''}`}
                  onClick={() => changeCategory(pickerItem.id, cat.id)}>
                  <span className="cat-option-icon">{cat.icon}</span>
                  <span className="cat-option-name">{cat.name}</span>
                  {pickerItem.category_id === cat.id && <span className="cat-option-check">✓</span>}
                </button>
              ))}
            </div>
          </BottomSheet>
        </div>
      )}

      {/* Categorise prompt for new uncategorised items */}
      {pendingItemData && (
        <div className="overlay" onClick={() => setPendingItemData(null)}>
          <BottomSheet onClose={() => setPendingItemData(null)}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <div>
                <p className="sheet-label">What category is this?</p>
                <p className="sheet-title">{pendingItemData.name}</p>
              </div>
              <button onClick={() => setPendingItemData(null)} className="sheet-close">✕</button>
            </div>
            <div className="sheet-body">
              {allCategories.map(cat => (
                <button key={cat.id} className="cat-option" onClick={() => confirmItemCategory(cat.id)}>
                  <span className="cat-option-icon">{cat.icon}</span>
                  <span className="cat-option-name">{cat.name}</span>
                </button>
              ))}
              <div style={{ padding: '0.75rem 1.25rem' }}>
                <button className="skip-btn" onClick={addPendingUncategorised}>
                  Skip — add without category
                </button>
              </div>
            </div>
          </BottomSheet>
        </div>
      )}

      {/* Settings */}
      {settingsOpen && (
        <div className="overlay" onClick={closeSettings}>
          <BottomSheet onClose={closeSettings}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <div
                style={{ display: 'flex', alignItems: 'center', cursor: settingsView !== 'main' ? 'pointer' : 'default' }}
                onClick={settingsView !== 'main' ? () => { setSettingsView('main'); setAddingCategory(false) } : undefined}
              >
                {settingsView !== 'main' && (
                  <span className="sheet-back">‹</span>
                )}
                <p className="sheet-title">
                  {settingsView === 'main' ? 'Settings' : settingsView === 'list' ? 'List Code' : 'Manage Categories'}
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
                      <span className="settings-nav-sub" style={{ fontFamily: 'inherit', letterSpacing: 0 }}>Drag to reorder</span>
                    </div>
                    <span className="settings-nav-arrow">›</span>
                  </button>
                  <p className="settings-divider-label" style={{ marginTop: '1.25rem' }}>Reset</p>
                  {confirming === 'list' ? (
                    <div className="confirm-row">
                      <span className="confirm-label">Clear entire list?</span>
                      <button className="confirm-cancel-btn" onClick={() => setConfirming(null)}>Cancel</button>
                      <button className="confirm-ok-btn" onClick={clearList}>Clear</button>
                    </div>
                  ) : (
                    <button className="settings-action-btn danger" onClick={() => requestConfirm('list')}>
                      Clear list
                    </button>
                  )}
                  {confirming === 'history' ? (
                    <div className="confirm-row" style={{ marginTop: '0.5rem' }}>
                      <span className="confirm-label">Clear all history?</span>
                      <button className="confirm-cancel-btn" onClick={() => setConfirming(null)}>Cancel</button>
                      <button className="confirm-ok-btn" onClick={clearHistory}>Clear</button>
                    </div>
                  ) : (
                    <button className="settings-action-btn danger" onClick={() => requestConfirm('history')} style={{ marginTop: '0.5rem' }}>
                      Clear history
                    </button>
                  )}
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
                    <input type="text" placeholder="Enter 6-letter code" value={settingsJoinCode}
                      onChange={e => setSettingsJoinCode(e.target.value.toUpperCase())}
                      maxLength="6" className="settings-join-input" autoCapitalize="characters" autoComplete="off" />
                    <button className="settings-join-btn" onClick={() => switchList(settingsJoinCode)}>Join</button>
                  </div>
                  <button className="settings-create-btn" onClick={async () => { closeSettings(); await createList() }}>
                    + Create new list
                  </button>
                  <p className="settings-divider-label">Leave</p>
                  <button className="settings-action-btn danger" onClick={() => { leaveList(); closeSettings() }}>
                    Leave this list
                  </button>
                </>
              )}
              {settingsView === 'categories' && (
                <>
                  {addingCategory ? (
                    <div className="new-cat-form">
                      <p className="settings-section-label" style={{ paddingTop: '0.25rem' }}>New Category</p>
                      <div className="new-cat-fields">
                        <input type="text" placeholder="🛒" value={newCatIcon}
                          onChange={e => setNewCatIcon(e.target.value)}
                          className="new-cat-icon-input" maxLength={2} />
                        <input type="text" placeholder="Category name" value={newCatName}
                          onChange={e => setNewCatName(e.target.value)}
                          className="new-cat-name-input" autoComplete="off" />
                      </div>
                      <div className="color-swatches">
                        {PRESET_COLORS.map(color => (
                          <button key={color} className={`color-swatch${newCatColor === color ? ' selected' : ''}`}
                            style={{ background: color }} onClick={() => setNewCatColor(color)} />
                        ))}
                      </div>
                      <div className="new-cat-actions">
                        <button className="settings-join-btn" onClick={saveNewCategory} disabled={!newCatName.trim()}>Save</button>
                        <button className="settings-create-btn new-cat-cancel" onClick={() => setAddingCategory(false)}>Cancel</button>
                      </div>
                      <div style={{ margin: '0.75rem 1.25rem 0', height: '1px', background: 'var(--border-subtle)' }} />
                    </div>
                  ) : (
                    <button className="settings-create-btn" style={{ margin: '0.75rem 1.25rem 0.25rem' }} onClick={() => setAddingCategory(true)}>
                      + Add Category
                    </button>
                  )}
                  <p className="settings-section-label" style={{ paddingTop: '0.75rem' }}>Order</p>
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
