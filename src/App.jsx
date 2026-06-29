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

const VERSION = '1.7.0'
const SNAP = 80
const AUTO = 220
const QUEUE_KEY = 'trolley_queue'

// --- Local cache ---
function getCachedItems(code) {
  try { return JSON.parse(localStorage.getItem(`trolley_items_${code}`) || '[]') } catch { return [] }
}
function setCachedItems(code, items) {
  try { localStorage.setItem(`trolley_items_${code}`, JSON.stringify(items)) } catch {}
}

// --- Offline queue ---
function getQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') } catch { return [] }
}
function saveQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)) } catch {}
}
function enqueue(op) {
  const q = getQueue(); q.push(op); saveQueue(q)
}

// --- Custom products (learned from your shopping habits) ---
// Stored as [{ name, category: categoryId }], separate from built-in products.json
function getCustomProducts() {
  try { return JSON.parse(localStorage.getItem('trolley_custom_products') || '[]') } catch { return [] }
}
function upsertCustomProduct(name, categoryId) {
  const existing = getCustomProducts()
  const idx = existing.findIndex(p => p.name.toLowerCase() === name.toLowerCase())
  if (idx >= 0) {
    existing[idx].category = categoryId
  } else {
    existing.push({ name, category: categoryId })
  }
  try { localStorage.setItem('trolley_custom_products', JSON.stringify(existing)) } catch {}
}

// --- Online status hook ---
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

// swipeEnabled=false for checked items: no red bg, no swipe gesture
function SwipeItem({ item, onToggle, onDelete, onPick, getCat, lastTapRef, swipeEnabled }) {
  const [tx, _setTx] = useState(0)
  const [animate, setAnimate] = useState(false)
  const txRef = useRef(0)
  const rowRef = useRef(null)
  const onDeleteRef = useRef(onDelete)
  useEffect(() => { onDeleteRef.current = onDelete }, [onDelete])

  function setTx(v) { txRef.current = v; _setTx(v) }

  useEffect(() => {
    if (!swipeEnabled) return
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
  }, [item.id, swipeEnabled])

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

  return (
    <div className="swipe-wrapper">
      {swipeEnabled && (
        <div className="swipe-bg">
          <button className="swipe-delete-btn" onClick={() => onDelete(item.id)}>Delete</button>
        </div>
      )}
      <div
        ref={rowRef}
        className={`swipe-row${animate ? ' animate' : ''}${item.checked ? ' checked' : ''}`}
        style={{ transform: `translateX(${tx}px)` }}
        onClick={handleClick}
        onDoubleClick={e => { if (!e.target.closest('button') && txRef.current === 0) onToggle(item.id, item.checked) }}
      >
        <button
          className={`check-btn${item.checked ? ' checked-btn' : ''}`}
          onClick={e => { e.stopPropagation(); onToggle(item.id, item.checked) }}
        >
          <span className="checkmark">{item.checked ? '✓' : ''}</span>
        </button>
        <span className="item-name">{item.name}</span>
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

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

// Replay queued offline operations against Supabase
async function flushQueue() {
  const q = getQueue()
  if (!q.length) return
  const failed = []
  for (const op of q) {
    try {
      if (op.type === 'INSERT') {
        await supabase.from('list_items').upsert(op.data, { onConflict: 'id' })
      } else if (op.type === 'UPDATE') {
        await supabase.from('list_items').update(op.data).eq('id', op.id)
      } else if (op.type === 'DELETE') {
        await supabase.from('list_items').delete().eq('id', op.id)
      }
    } catch {
      failed.push(op)
    }
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

export default function App() {
  const [listCode, setListCode] = useState(null)
  const [inputCode, setInputCode] = useState('')
  const [items, setItems] = useState([])
  const [input, setInput] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pickerItem, setPickerItem] = useState(null)
  const [categoryOrder, setCategoryOrder] = useState(loadCategoryOrder)
  const inputRef = useRef(null)
  const channelRef = useRef(null)
  const lastTapRef = useRef({})
  const listCodeRef = useRef(null)
  const online = useOnlineStatus()
  const prevOnlineRef = useRef(true)

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

  // Sync when connection is restored
  useEffect(() => {
    if (online && !prevOnlineRef.current && listCodeRef.current) {
      loadAndSubscribe(listCodeRef.current)
    }
    prevOnlineRef.current = online
  }, [online])

  async function loadAndSubscribe(code) {
    channelRef.current?.unsubscribe()

    // Show cached data immediately so app works offline
    const cached = getCachedItems(code)
    if (cached.length > 0) setItems(cached)

    if (!navigator.onLine) return

    // Send any queued offline changes before fetching
    await flushQueue()

    const { data } = await supabase
      .from('list_items').select('*').eq('list_code', code).order('created_at', { ascending: true })

    if (data) {
      setItems(data)
      setCachedItems(code, data)
    }

    channelRef.current = supabase
      .channel(`list:${code}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'list_items', filter: `list_code=eq.${code}` },
        (payload) => {
          setItems(prev => {
            let next = prev
            if (payload.eventType === 'INSERT') {
              // Skip if already present from optimistic update
              if (prev.some(i => i.id === payload.new.id)) return prev
              next = [...prev, payload.new]
            }
            if (payload.eventType === 'UPDATE') next = prev.map(i => i.id === payload.new.id ? payload.new : i)
            if (payload.eventType === 'DELETE') next = prev.filter(i => i.id !== payload.old.id)
            setCachedItems(code, next)
            return next
          })
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
    if (value.length < 2) { setSuggestions([]); return }
    const search = value.toLowerCase()

    const customMatches = getCustomProducts()
      .filter(p => p.name.toLowerCase().includes(search))

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
    const category = products.categories.find(c => c.id === product.category)
    const newItem = {
      id: crypto.randomUUID(),
      list_code: listCode,
      name: product.name,
      category: category.name,
      category_id: product.category,
      checked: false,
      created_at: new Date().toISOString(),
    }
    setItems(prev => { const next = [...prev, newItem]; setCachedItems(listCode, next); return next })
    setInput(''); setSuggestions([]); inputRef.current?.focus()
    if (navigator.onLine) {
      await supabase.from('list_items').upsert(newItem, { onConflict: 'id' })
    } else {
      enqueue({ type: 'INSERT', data: newItem })
    }
  }

  async function addCustomItem(name) {
    // Only save truly novel items to the learned database (skip if already in built-in products)
    const isBuiltIn = products.products.some(p => p.name.toLowerCase() === name.toLowerCase())
    if (!isBuiltIn) upsertCustomProduct(name, 'other')

    const newItem = {
      id: crypto.randomUUID(),
      list_code: listCode,
      name,
      category: 'Other',
      category_id: 'other',
      checked: false,
      created_at: new Date().toISOString(),
    }
    setItems(prev => { const next = [...prev, newItem]; setCachedItems(listCode, next); return next })
    setInput(''); setSuggestions([]); inputRef.current?.focus()
    if (navigator.onLine) {
      await supabase.from('list_items').upsert(newItem, { onConflict: 'id' })
    } else {
      enqueue({ type: 'INSERT', data: newItem })
    }
  }

  async function toggleItem(id, checked) {
    setItems(prev => { const next = prev.map(i => i.id === id ? { ...i, checked: !checked } : i); setCachedItems(listCode, next); return next })
    if (navigator.onLine) {
      await supabase.from('list_items').update({ checked: !checked }).eq('id', id)
    } else {
      enqueue({ type: 'UPDATE', id, data: { checked: !checked } })
    }
  }

  async function deleteItem(id) {
    setItems(prev => { const next = prev.filter(i => i.id !== id); setCachedItems(listCode, next); return next })
    if (navigator.onLine) {
      await supabase.from('list_items').delete().eq('id', id)
    } else {
      enqueue({ type: 'DELETE', id })
    }
  }

  async function clearChecked() {
    const ids = items.filter(i => i.checked).map(i => i.id)
    if (!ids.length) return
    setItems(prev => { const next = prev.filter(i => !i.checked); setCachedItems(listCode, next); return next })
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
          <span className="code-badge">{listCode}</span>
          <button onClick={() => setSettingsOpen(true)} className="icon-btn" aria-label="Settings">⚙️</button>
          <button onClick={leaveList} className="leave-btn" aria-label="Leave list">✕</button>
        </div>
      </header>

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
                <span className="suggestion-name">{p.name}</span>
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
                <ul>
                  {catItems.map(item => (
                    <SwipeItem
                      key={item.id}
                      item={item}
                      onToggle={toggleItem}
                      onDelete={deleteItem}
                      onPick={setPickerItem}
                      getCat={getCat}
                      lastTapRef={lastTapRef}
                      swipeEnabled={true}
                    />
                  ))}
                </ul>
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
                    <ul>
                      {catItems.map(item => (
                        <SwipeItem
                          key={item.id}
                          item={item}
                          onToggle={toggleItem}
                          onDelete={deleteItem}
                          onPick={setPickerItem}
                          getCat={getCat}
                          lastTapRef={lastTapRef}
                          swipeEnabled={false}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {pickerItem && (
        <div className="overlay" onClick={() => setPickerItem(null)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
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
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="overlay" onClick={() => setSettingsOpen(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <p className="sheet-title">Settings</p>
              <button onClick={() => setSettingsOpen(false)} className="sheet-close">✕</button>
            </div>
            <div className="sheet-body">
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
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
