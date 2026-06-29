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

const VERSION = '1.4.0'

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
    if (saved) { setListCode(saved); loadAndSubscribe(saved) }
    return () => channelRef.current?.unsubscribe()
  }, [])

  useEffect(() => {
    localStorage.setItem('trolley_cat_order', JSON.stringify(categoryOrder))
  }, [categoryOrder])

  async function loadAndSubscribe(code) {
    channelRef.current?.unsubscribe()
    const { data } = await supabase
      .from('list_items').select('*').eq('list_code', code).order('created_at', { ascending: true })
    setItems(data || [])
    channelRef.current = supabase
      .channel(`list:${code}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'list_items', filter: `list_code=eq.${code}` },
        (payload) => {
          setItems(prev => {
            if (payload.eventType === 'INSERT') return [...prev, payload.new]
            if (payload.eventType === 'UPDATE') return prev.map(i => i.id === payload.new.id ? payload.new : i)
            if (payload.eventType === 'DELETE') return prev.filter(i => i.id !== payload.old.id)
            return prev
          })
        })
      .subscribe()
  }

  async function joinList(e) {
    e.preventDefault()
    const code = inputCode.trim().toUpperCase()
    if (!code) return
    localStorage.setItem('trolley_code', code)
    setListCode(code)
    await loadAndSubscribe(code)
    setInputCode('')
  }

  async function createList() {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase()
    await supabase.from('lists').insert({ code })
    localStorage.setItem('trolley_code', code)
    setListCode(code)
    await loadAndSubscribe(code)
  }

  function handleInputChange(e) {
    const value = e.target.value
    setInput(value)
    if (value.length < 2) { setSuggestions([]); return }
    const search = value.toLowerCase()
    const matches = products.products
      .filter(p => p.name.toLowerCase().includes(search) || p.keywords.some(k => k.includes(search)))
      .slice(0, 8)
    setSuggestions(matches)
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
    await supabase.from('list_items').insert({
      list_code: listCode, name: product.name,
      category: category.name, category_id: product.category, checked: false,
    })
    setInput(''); setSuggestions([]); inputRef.current?.focus()
  }

  async function addCustomItem(name) {
    await supabase.from('list_items').insert({
      list_code: listCode, name,
      category: 'Other', category_id: 'other', checked: false,
    })
    setInput(''); setSuggestions([]); inputRef.current?.focus()
  }

  async function toggleItem(id, checked) {
    await supabase.from('list_items').update({ checked: !checked }).eq('id', id)
  }

  async function deleteItem(id) {
    await supabase.from('list_items').delete().eq('id', id)
  }

  async function clearChecked() {
    const ids = items.filter(i => i.checked).map(i => i.id)
    if (!ids.length) return
    await supabase.from('list_items').delete().in('id', ids)
  }

  async function changeCategory(itemId, newCatId) {
    const cat = products.categories.find(c => c.id === newCatId)
    await supabase.from('list_items').update({ category: cat.name, category_id: newCatId }).eq('id', itemId)
    setPickerItem(null)
  }

  function handleRowTap(e, id, checked) {
    if (e.target.closest('button')) return
    const now = Date.now()
    const last = lastTapRef.current[id] || 0
    if (now - last < 400) {
      lastTapRef.current[id] = 0
      toggleItem(id, checked)
    } else {
      lastTapRef.current[id] = now
    }
  }

  function leaveList() {
    channelRef.current?.unsubscribe()
    localStorage.removeItem('trolley_code')
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
                    <li
                      key={item.id}
                      onClick={e => handleRowTap(e, item.id, item.checked)}
                      onDoubleClick={e => { if (!e.target.closest('button')) toggleItem(item.id, item.checked) }}
                    >
                      <button className="check-btn" onClick={() => toggleItem(item.id, item.checked)}>
                        <span className="checkmark" />
                      </button>
                      <span className="item-name">{item.name}</span>
                      <button className="cat-change-btn" onClick={() => setPickerItem(item)} title="Change category">
                        {getCat(item.category_id)?.icon ?? '🏷️'}
                      </button>
                      <button onClick={() => deleteItem(item.id)} className="delete-btn">✕</button>
                    </li>
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
                        <li
                          key={item.id}
                          className="checked"
                          onClick={e => handleRowTap(e, item.id, item.checked)}
                          onDoubleClick={e => { if (!e.target.closest('button')) toggleItem(item.id, item.checked) }}
                        >
                          <button className="check-btn checked-btn" onClick={() => toggleItem(item.id, item.checked)}>
                            <span className="checkmark">✓</span>
                          </button>
                          <span className="item-name">{item.name}</span>
                          <button onClick={() => deleteItem(item.id)} className="delete-btn">✕</button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Category picker */}
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

      {/* Settings */}
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
