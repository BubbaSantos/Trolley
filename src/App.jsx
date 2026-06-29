import { useState, useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import products from './data/products.json'
import './App.css'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

export default function App() {
  const [listCode, setListCode] = useState(null)
  const [inputCode, setInputCode] = useState('')
  const [items, setItems] = useState([])
  const [input, setInput] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const inputRef = useRef(null)
  const channelRef = useRef(null)

  useEffect(() => {
    const saved = localStorage.getItem('trolley_code')
    if (saved) {
      setListCode(saved)
      loadAndSubscribe(saved)
    }
    return () => channelRef.current?.unsubscribe()
  }, [])

  async function loadAndSubscribe(code) {
    channelRef.current?.unsubscribe()

    const { data } = await supabase
      .from('list_items')
      .select('*')
      .eq('list_code', code)
      .order('created_at', { ascending: true })

    setItems(data || [])

    channelRef.current = supabase
      .channel(`list:${code}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'list_items',
        filter: `list_code=eq.${code}`,
      }, (payload) => {
        setItems((prev) => {
          if (payload.eventType === 'INSERT') return [...prev, payload.new]
          if (payload.eventType === 'UPDATE') return prev.map((i) => i.id === payload.new.id ? payload.new : i)
          if (payload.eventType === 'DELETE') return prev.filter((i) => i.id !== payload.old.id)
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
      .filter((p) =>
        p.name.toLowerCase().includes(search) ||
        p.keywords.some((k) => k.includes(search))
      )
      .slice(0, 8)
    setSuggestions(matches)
  }

  async function handleKeyDown(e) {
    if (e.key === 'Enter' && input.trim()) {
      if (suggestions.length > 0) {
        await addItem(suggestions[0])
      } else {
        await addCustomItem(input.trim())
      }
    }
    if (e.key === 'Escape') setSuggestions([])
  }

  async function addItem(product) {
    const category = products.categories.find((c) => c.id === product.category)
    await supabase.from('list_items').insert({
      list_code: listCode,
      name: product.name,
      category: category.name,
      category_id: product.category,
      checked: false,
    })
    setInput('')
    setSuggestions([])
    inputRef.current?.focus()
  }

  async function addCustomItem(name) {
    await supabase.from('list_items').insert({
      list_code: listCode,
      name,
      category: 'Other',
      category_id: 'other',
      checked: false,
    })
    setInput('')
    setSuggestions([])
    inputRef.current?.focus()
  }

  async function toggleItem(id, checked) {
    await supabase.from('list_items').update({ checked: !checked }).eq('id', id)
  }

  async function deleteItem(id) {
    await supabase.from('list_items').delete().eq('id', id)
  }

  async function clearChecked() {
    const checkedIds = items.filter((i) => i.checked).map((i) => i.id)
    if (checkedIds.length === 0) return
    await supabase.from('list_items').delete().in('id', checkedIds)
  }

  function leaveList() {
    channelRef.current?.unsubscribe()
    localStorage.removeItem('trolley_code')
    setListCode(null)
    setItems([])
    setInput('')
    setSuggestions([])
  }

  const grouped = products.categories
    .map((cat) => ({
      category: cat,
      items: items.filter((i) => i.category_id === cat.id),
    }))
    .filter((g) => g.items.length > 0)

  const checkedCount = items.filter((i) => i.checked).length

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
              type="text"
              placeholder="Enter 6-letter code"
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value.toUpperCase())}
              maxLength="6"
              className="code-input"
              autoCapitalize="characters"
              autoComplete="off"
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
        <div className="header-left">
          <span className="logo">🛒</span>
          <h1>Trolley</h1>
        </div>
        <div className="header-right">
          <span className="code-badge" title="Share this code with your partner">{listCode}</span>
          <button onClick={leaveList} className="leave-btn" title="Leave list">✕</button>
        </div>
      </header>

      <div className="input-section">
        <input
          ref={inputRef}
          type="text"
          placeholder="Add item..."
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          className="item-input"
          autoComplete="off"
        />
        {suggestions.length > 0 && (
          <div className="suggestions">
            {suggestions.map((p) => (
              <button key={p.name} onClick={() => addItem(p)} className="suggestion-item">
                <span className="suggestion-name">{p.name}</span>
                <span className="suggestion-cat">
                  {products.categories.find((c) => c.id === p.category)?.icon}{' '}
                  {products.categories.find((c) => c.id === p.category)?.name}
                </span>
              </button>
            ))}
            {input.trim() && (
              <button onClick={() => addCustomItem(input.trim())} className="suggestion-item suggestion-custom">
                <span className="suggestion-name">Add &ldquo;{input.trim()}&rdquo;</span>
                <span className="suggestion-cat">Other</span>
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
                  <span className="cat-count">{catItems.filter(i => !i.checked).length}/{catItems.length}</span>
                </h2>
                <ul>
                  {catItems.map((item) => (
                    <li key={item.id} className={item.checked ? 'checked' : ''}>
                      <button className="check-btn" onClick={() => toggleItem(item.id, item.checked)}>
                        <span className="checkmark">{item.checked ? '✓' : ''}</span>
                      </button>
                      <span className="item-name">{item.name}</span>
                      <button onClick={() => deleteItem(item.id)} className="delete-btn" aria-label="Remove">✕</button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {checkedCount > 0 && (
            <button onClick={clearChecked} className="clear-btn">
              Clear {checkedCount} checked item{checkedCount !== 1 ? 's' : ''}
            </button>
          )}
        </>
      )}
    </div>
  )
}
