'use client'

import { useState, useEffect, useRef, useMemo } from 'react'

// ==================== TYPES ====================

interface MCServer {
  id: string
  name: string
  displayName?: string
  version: string
  serverType: string
  edition: 'java' | 'bedrock' | 'crossplay'
  port: number
  bedrockPort?: number
  maxMemory?: number
  status: string
  playersOnline: number
  playersList: PlayerInfo[]
  maxPlayers: number
  gamemode?: string
  difficulty?: string
  geyserEnabled?: boolean
  tps: number
  memoryUsed: number
  cpuUsage: number
  uptime: number
  whitelistPlayers: WhitelistEntry[]
  bannedPlayers: BanEntry[]
  operators: OperatorEntry[]
  createdAt: string
}

interface PlayerInfo { name: string; edition?: 'java' | 'bedrock'; joinTime?: string }
interface WhitelistEntry { name: string; uuid: string; addedAt: string }
interface BanEntry { name?: string; reason: string; bannedAt: string }
interface OperatorEntry { name: string; level: number }

interface Plugin {
  id: string
  name: string
  displayName: string
  description: string
  author: string
  version: string
  category: string
  downloads: number
  rating: number
  isCrossplay?: boolean
}

interface ServerTemplate {
  id: string
  name: string
  displayName: string
  description: string
  icon: string
  edition: 'java' | 'bedrock' | 'crossplay'
  serverType: string
  version: string
  features: string[]
}

interface FileInfo { name: string; path: string; type: 'file' | 'directory'; size: number; editable: boolean }
interface VersionInfo { total: { java: number; bedrock: number } }

// ==================== HELPERS ====================

const colors: Record<string, string> = { '0': '#000', '1': '#00A', '2': '#0A0', '3': '#0AA', '4': '#A00', '5': '#A0A', '6': '#FA0', '7': '#AAA', '8': '#555', '9': '#55F', 'a': '#5F5', 'b': '#5FF', 'c': '#F55', 'd': '#F5F', 'e': '#FF5', 'f': '#FFF' }

function parseMC(text: string) {
  const parts: (string | JSX.Element)[] = []
  let cur = '', col = '', k = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '§' && colors[text[i+1]]) {
      if (cur) parts.push(<span key={k++} style={col ? { color: col } : {}}>{cur}</span>)
      cur = ''; col = colors[text[++i]]
    } else if (text[i] === '\n') {
      if (cur) parts.push(<span key={k++} style={col ? { color: col } : {}}>{cur}</span>)
      cur = ''; parts.push(<br key={k++} />)
    } else { cur += text[i] }
  }
  if (cur) parts.push(<span key={k} style={col ? { color: col } : {}}>{cur}</span>)
  return <>{parts}</>
}

const fmtBytes = (b: number) => b ? parseFloat((b / Math.pow(1024, Math.floor(Math.log(b) / Math.log(1024)))).toFixed(2)) + ' ' + ['B','KB','MB','GB','TB'][Math.floor(Math.log(b) / Math.log(1024))] : '0 B'
const fmtUptime = (ms: number) => { const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24); return d ? `${d}d ${h%24}h` : h ? `${h}h ${m%60}m` : m ? `${m}m` : `${s}s` }

function Badge({ edition }: { edition: string }) {
  const s: Record<string, string> = { java: 'bg-blue-500/20 text-blue-400', bedrock: 'bg-orange-500/20 text-orange-400', crossplay: 'bg-purple-500/20 text-purple-400' }
  const i: Record<string, string> = { java: '☕', bedrock: '🪨', crossplay: '🎮' }
  return <span className={`text-xs px-2 py-1 rounded-full ${s[edition]}`}>{i[edition]} {edition === 'crossplay' ? 'Cross-Play' : edition}</span>
}

function Status({ status }: { status: string }) {
  const c: Record<string, string> = { running: 'bg-green-500', stopped: 'bg-gray-500', starting: 'bg-yellow-500 animate-pulse', stopping: 'bg-orange-500 animate-pulse', crashed: 'bg-red-500' }
  return <div className={`w-2.5 h-2.5 rounded-full ${c[status] || 'bg-gray-400'}`} />
}

// ==================== MAIN ====================

export default function MinecraftManager() {
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [servers, setServers] = useState<MCServer[]>([])
  const [templates, setTemplates] = useState<ServerTemplate[]>([])
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [javaGroups, setJavaGroups] = useState<Record<string, string[]>>({})
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null)
  const [selectedServer, setSelectedServer] = useState<MCServer | null>(null)
  const [files, setFiles] = useState<FileInfo[]>([])
  const [currentFile, setCurrentFile] = useState<{ path: string; content: string } | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showPlugins, setShowPlugins] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'console' | 'players' | 'files' | 'settings'>('overview')
  const [loading, setLoading] = useState(true)
  
  // Forms
  const [createForm, setCreateForm] = useState({ name: '', version: '1.21.4', serverType: 'paper', port: 25565, bedrockPort: 19132, maxMemory: 2048, maxPlayers: 50, crossplay: true })
  const [playerInput, setPlayerInput] = useState('')
  const [command, setCommand] = useState('')
  const [pluginSearch, setPluginSearch] = useState('')
  const [pluginCategory, setPluginCategory] = useState('All')
  
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  
  // ==================== API ====================
  
  const fetchData = async (type: string, params?: Record<string, string>) => {
    try {
      const url = new URLSearchParams({ type, ...params })
      const res = await fetch(`/api/minecraft?${url}`)
      return await res.json()
    } catch { return null }
  }
  
  const sendAction = async (action: string, data: Record<string, any> = {}) => {
    try {
      const res = await fetch('/api/minecraft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...data })
      })
      return await res.json()
    } catch { return null }
  }
  
  // ==================== POLLING ====================
  
  const refreshData = async () => {
    const [serversData, versionsData, templatesData, pluginsData] = await Promise.all([
      fetchData('servers'),
      fetchData('versions'),
      fetchData('templates'),
      fetchData('plugins')
    ])
    if (serversData) setServers(serversData)
    if (versionsData) { 
      setJavaGroups(versionsData.javaGroups || {})
      setVersionInfo(versionsData.total || null)
    }
    if (templatesData) setTemplates(templatesData)
    if (pluginsData) { setPlugins(pluginsData.plugins || []); setCategories(pluginsData.categories || []) }
    setLoading(false)
    setConnection('connected')
  }
  
  useEffect(() => {
    refreshData()
    pollingRef.current = setInterval(refreshData, 5000)
    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [])
  
  // File refresh
  useEffect(() => {
    if (selectedServer && activeTab === 'files') {
      fetchData('files', { serverId: selectedServer.id }).then(d => d?.files && setFiles(d.files))
    }
  }, [selectedServer, activeTab])
  
  // Stats
  const stats = useMemo(() => ({
    total: servers.length, running: servers.filter(s => s.status === 'running').length,
    java: servers.filter(s => s.edition === 'java').length, bedrock: servers.filter(s => s.edition === 'bedrock').length,
    crossplay: servers.filter(s => s.edition === 'crossplay').length, players: servers.reduce((a, s) => a + s.playersOnline, 0)
  }), [servers])
  
  const filteredPlugins = useMemo(() => {
    let r = plugins
    if (pluginSearch) r = r.filter(p => p.name.toLowerCase().includes(pluginSearch.toLowerCase()) || p.description.toLowerCase().includes(pluginSearch.toLowerCase()))
    if (pluginCategory !== 'All') r = r.filter(p => p.category === pluginCategory)
    return r.sort((a, b) => b.downloads - a.downloads)
  }, [plugins, pluginSearch, pluginCategory])
  
  // Version groups sorted
  const sortedVersionGroups = useMemo(() => {
    return Object.entries(javaGroups)
      .sort(([a], [b]) => {
        const verA = parseFloat(a.replace('1.', ''))
        const verB = parseFloat(b.replace('1.', ''))
        return verB - verA
      })
  }, [javaGroups])
  
  // ==================== RENDER ====================
  
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-green-500/20">
              <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
            </div>
            <div>
              <h1 className="text-xl font-bold">Minecraft Server Manager</h1>
              <p className="text-sm text-muted-foreground">
                {versionInfo ? `${versionInfo.java + versionInfo.bedrock} Versions • Cross-Play Support` : 'Loading...'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${connection === 'connected' ? 'bg-green-500/10' : 'bg-yellow-500/10'}`}>
              <div className={`w-2 h-2 rounded-full ${connection === 'connected' ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`} />
              <span className="text-sm capitalize">{connection}</span>
            </div>
            <button onClick={() => setShowVersions(true)} className="px-4 py-2 border rounded-lg hover:bg-muted">📊 Versions</button>
            <button onClick={() => setShowTemplates(true)} className="px-4 py-2 border rounded-lg hover:bg-muted">📁 Templates</button>
            <button onClick={() => setShowPlugins(true)} className="px-4 py-2 border rounded-lg hover:bg-muted">🧩 Plugins</button>
            <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium">+ New Server</button>
          </div>
        </div>
      </header>
      
      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
          {[['Total Servers', stats.total, ''], ['☕ Java', stats.java, 'text-blue-500'], ['🪨 Bedrock', stats.bedrock, 'text-orange-500'], ['🎮 Cross-Play', stats.crossplay, 'text-purple-500'], ['Running', stats.running, 'text-green-500'], ['Players Online', stats.players, '']].map(([l, v, c], i) => (
            <div key={i} className="bg-card border rounded-xl p-4"><p className="text-sm text-muted-foreground">{l}</p><p className={`text-2xl font-bold ${c}`}>{v}</p></div>
          ))}
        </div>
        
        {/* Version Info Banner */}
        {versionInfo && (
          <div className="bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-orange-500/10 rounded-xl p-4 mb-6 border border-primary/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-blue-500">{versionInfo.java}</p>
                  <p className="text-sm text-muted-foreground">Java Versions</p>
                </div>
                <div className="w-px h-12 bg-border" />
                <div className="text-center">
                  <p className="text-3xl font-bold text-orange-500">{versionInfo.bedrock}</p>
                  <p className="text-sm text-muted-foreground">Bedrock Versions</p>
                </div>
                <div className="w-px h-12 bg-border" />
                <div className="text-center">
                  <p className="text-3xl font-bold text-purple-500">{versionInfo.java + versionInfo.bedrock}</p>
                  <p className="text-sm text-muted-foreground">Total Versions</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">Supporting MC 1.0 through 1.21.x</p>
            </div>
          </div>
        )}
        
        {/* Loading / Empty / Servers */}
        {loading ? (
          <div className="flex flex-col items-center py-20"><div className="animate-spin w-12 h-12 border-4 border-primary border-t-transparent rounded-full mb-4" /><p className="text-muted-foreground">Loading...</p></div>
        ) : servers.length === 0 ? (
          <div className="bg-card border rounded-2xl p-16 text-center">
            <div className="w-20 h-20 bg-muted rounded-2xl flex items-center justify-center mx-auto mb-6 text-4xl">🎮</div>
            <h3 className="text-xl font-semibold mb-2">No Servers Yet</h3>
            <p className="text-muted-foreground mb-6">Create your first Minecraft server with {versionInfo?.java || 0}+ Java versions and {versionInfo?.bedrock || 0}+ Bedrock versions!</p>
            <div className="flex justify-center gap-3">
              <button onClick={() => setShowTemplates(true)} className="px-6 py-3 border rounded-xl font-medium">Browse Templates</button>
              <button onClick={() => setShowCreate(true)} className="px-6 py-3 bg-primary text-primary-foreground rounded-xl font-medium">Create Server</button>
            </div>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {servers.map(s => (
              <div key={s.id} onClick={() => setSelectedServer(s)} className="bg-card rounded-xl border p-5 hover:border-primary/50 cursor-pointer group">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2"><Status status={s.status} /><span className="text-sm font-medium capitalize">{s.status}</span></div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                    {s.status === 'stopped' && <button onClick={e => { e.stopPropagation(); sendAction('start', { serverId: s.id }) }} className="p-2 rounded bg-green-500/10 text-green-500">▶</button>}
                    {s.status === 'running' && <><button onClick={e => { e.stopPropagation(); sendAction('restart', { serverId: s.id }) }} className="p-2 rounded bg-yellow-500/10 text-yellow-500">↻</button><button onClick={e => { e.stopPropagation(); sendAction('stop', { serverId: s.id }) }} className="p-2 rounded bg-red-500/10 text-red-500">■</button></>}
                    <button onClick={e => { e.stopPropagation(); if (confirm('Delete this server?')) sendAction('delete', { serverId: s.id }) }} className="p-2 rounded bg-gray-500/10 text-gray-500">🗑</button>
                  </div>
                </div>
                <h3 className="font-semibold text-lg mb-1">{s.name}</h3>
                <div className="flex items-center gap-2 mb-4"><Badge edition={s.edition} /><span className="text-sm text-muted-foreground">{s.serverType} {s.version}</span></div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-muted/30 rounded-lg p-2 text-center"><p className="text-lg font-bold text-green-500">{s.playersOnline}</p><p className="text-xs text-muted-foreground">Players</p></div>
                  <div className="bg-muted/30 rounded-lg p-2 text-center"><p className="text-lg font-bold">{s.tps.toFixed(1)}</p><p className="text-xs text-muted-foreground">TPS</p></div>
                  <div className="bg-muted/30 rounded-lg p-2 text-center"><p className="text-lg font-bold">:{s.port}</p>{s.bedrockPort && <p className="text-xs text-orange-400">:{s.bedrockPort}</p>}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      
      {/* Versions Modal */}
      {showVersions && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card">
              <div>
                <h2 className="text-xl font-bold">Minecraft Versions</h2>
                <p className="text-sm text-muted-foreground">{versionInfo?.java || 0} Java + {versionInfo?.bedrock || 0} Bedrock = {versionInfo ? versionInfo.java + versionInfo.bedrock : 0} Total</p>
              </div>
              <button onClick={() => setShowVersions(false)} className="p-2 hover:bg-muted rounded-lg text-xl">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid md:grid-cols-2 gap-6">
                {/* Java Versions */}
                <div>
                  <h3 className="font-bold text-lg mb-3 flex items-center gap-2">☕ Java Edition <span className="text-sm font-normal text-muted-foreground">({versionInfo?.java || 0} versions)</span></h3>
                  <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
                    {sortedVersionGroups.map(([major, versions]) => (
                      <div key={major} className="bg-muted/30 rounded-lg p-3">
                        <p className="font-medium mb-2 text-sm">1.{major} {major === '21' ? '(Latest)' : ''}</p>
                        <div className="flex flex-wrap gap-1">
                          {versions.map(v => (
                            <span key={v} className="text-xs px-2 py-1 bg-background rounded">{v}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Bedrock Versions */}
                <div>
                  <h3 className="font-bold text-lg mb-3 flex items-center gap-2">🪨 Bedrock Edition <span className="text-sm font-normal text-muted-foreground">({versionInfo?.bedrock || 0} versions)</span></h3>
                  <div className="bg-muted/30 rounded-lg p-3 max-h-[60vh] overflow-y-auto">
                    <div className="flex flex-wrap gap-1">
                      {(Object.values(javaGroups).flat().slice(0, 50) || []).map((v, i) => (
                        <span key={i} className="text-xs px-2 py-1 bg-background rounded">{v}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card"><h2 className="text-xl font-bold">Create New Server</h2><button onClick={() => setShowCreate(false)} className="p-2 hover:bg-muted rounded-lg text-xl">×</button></div>
            <div className="p-4 space-y-4">
              <div><label className="block text-sm font-medium mb-2">Server Name *</label><input value={createForm.name} onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))} placeholder="My Server" className="w-full px-4 py-2 bg-background border rounded-lg" /></div>
              <div><label className="block text-sm font-medium mb-2">Server Type</label><div className="grid grid-cols-3 gap-2">{[{ id: 'paper', n: 'Paper', i: '⚡', desc: 'High performance' }, { id: 'spigot', n: 'Spigot', i: '🔧', desc: 'Classic' }, { id: 'vanilla', n: 'Vanilla', i: '☕', desc: 'Official' }].map(t => (<button key={t.id} onClick={() => setCreateForm(p => ({ ...p, serverType: t.id }))} className={`p-3 rounded-lg border text-left ${createForm.serverType === t.id ? 'border-primary bg-primary/10' : ''}`}><span className="text-lg">{t.i}</span><p className="font-medium">{t.n}</p><p className="text-xs text-muted-foreground">{t.desc}</p></button>))}</div></div>
              <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg"><div><p className="font-medium">🎮 Cross-Play Support</p><p className="text-sm text-muted-foreground">Java + Bedrock players can join together</p></div><button onClick={() => setCreateForm(p => ({ ...p, crossplay: !p.crossplay }))} className={`w-12 h-6 rounded-full ${createForm.crossplay ? 'bg-primary' : 'bg-muted'}`}><div className={`w-5 h-5 bg-white rounded-full transition-transform ${createForm.crossplay ? 'translate-x-6' : 'translate-x-0.5'}`} /></button></div>
              <div><label className="block text-sm font-medium mb-2">Minecraft Version</label><select value={createForm.version} onChange={e => setCreateForm(p => ({ ...p, version: e.target.value }))} className="w-full px-4 py-2 bg-background border rounded-lg">
                <optgroup label="🆕 Latest (1.21.x)">{['1.21.5', '1.21.4', '1.21.3', '1.21.2', '1.21.1', '1.21'].map(v => <option key={v} value={v}>{v}</option>)}</optgroup>
                {sortedVersionGroups.filter(([g]) => g !== '1.21').map(([group, versions]) => (<optgroup key={group} label={`📦 Java 1.${group}`}>{versions.slice(0, 5).map(v => <option key={v} value={v}>{v}</option>)}</optgroup>))}
              </select></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-2">Max Players</label><input type="number" value={createForm.maxPlayers} onChange={e => setCreateForm(p => ({ ...p, maxPlayers: parseInt(e.target.value) || 20 }))} className="w-full px-4 py-2 bg-background border rounded-lg" /></div>
                <div><label className="block text-sm font-medium mb-2">Memory (MB)</label><select value={createForm.maxMemory} onChange={e => setCreateForm(p => ({ ...p, maxMemory: parseInt(e.target.value) }))} className="w-full px-4 py-2 bg-background border rounded-lg">
                  <option value="1024">1 GB</option>
                  <option value="2048">2 GB</option>
                  <option value="4096">4 GB</option>
                  <option value="6144">6 GB</option>
                  <option value="8192">8 GB</option>
                  <option value="12288">12 GB</option>
                  <option value="16384">16 GB</option>
                </select></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-2">Java Port</label><input type="number" value={createForm.port} onChange={e => setCreateForm(p => ({ ...p, port: parseInt(e.target.value) || 25565 }))} className="w-full px-4 py-2 bg-background border rounded-lg" /></div>
                {createForm.crossplay && <div><label className="block text-sm font-medium mb-2">Bedrock Port</label><input type="number" value={createForm.bedrockPort} onChange={e => setCreateForm(p => ({ ...p, bedrockPort: parseInt(e.target.value) || 19132 }))} className="w-full px-4 py-2 bg-background border rounded-lg" /></div>}
              </div>
            </div>
            <div className="p-4 border-t flex justify-end gap-3"><button onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded-lg">Cancel</button><button onClick={() => { if (!createForm.name.trim()) return; sendAction('create', { ...createForm, geyserEnabled: createForm.crossplay, floodgateEnabled: createForm.crossplay }); setShowCreate(false); setCreateForm({ name: '', version: '1.21.4', serverType: 'paper', port: 25565, bedrockPort: 19132, maxMemory: 2048, maxPlayers: 50, crossplay: true }) }} disabled={!createForm.name.trim()} className="px-6 py-2 bg-primary text-primary-foreground rounded-lg font-medium disabled:opacity-50">Create Server</button></div>
          </div>
        </div>
      )}
      
      {/* Templates Modal */}
      {showTemplates && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border w-full max-w-5xl max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-card"><h2 className="text-xl font-bold">Server Templates ({templates.length})</h2><button onClick={() => setShowTemplates(false)} className="p-2 hover:bg-muted rounded-lg text-xl">×</button></div>
            <div className="p-4 grid md:grid-cols-2 lg:grid-cols-3 gap-4">{templates.map(t => (<div key={t.id} onClick={() => { setCreateForm(p => ({ ...p, name: t.displayName, version: t.version, serverType: t.serverType, crossplay: t.edition === 'crossplay' })); setShowTemplates(false); setShowCreate(true) }} className="border rounded-xl p-4 hover:border-primary/50 cursor-pointer transition-colors"><div className="flex items-start gap-3"><span className="text-3xl">{t.icon}</span><div className="flex-1"><div className="flex items-center gap-2 mb-1"><h3 className="font-semibold">{t.displayName}</h3><Badge edition={t.edition} /></div><p className="text-sm text-muted-foreground mb-2">{t.description}</p><div className="flex flex-wrap gap-1">{t.features.slice(0, 3).map((f, i) => <span key={i} className="text-xs px-2 py-0.5 bg-muted rounded">{f}</span>)}</div></div></div></div>))}</div>
          </div>
        </div>
      )}
      
      {/* Plugins Modal */}
      {showPlugins && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b"><div className="flex items-center justify-between mb-4"><div><h2 className="text-xl font-bold">Plugin Marketplace</h2><p className="text-sm text-muted-foreground">{plugins.length} plugins available</p></div><button onClick={() => setShowPlugins(false)} className="p-2 hover:bg-muted rounded-lg text-xl">×</button></div><div className="flex gap-3"><input value={pluginSearch} onChange={e => setPluginSearch(e.target.value)} placeholder="Search plugins..." className="flex-1 px-4 py-2 bg-background border rounded-lg" /><select value={pluginCategory} onChange={e => setPluginCategory(e.target.value)} className="px-4 py-2 bg-background border rounded-lg">{categories.map(c => <option key={c} value={c}>{c}</option>)}</select></div></div>
            <div className="flex-1 overflow-y-auto p-4"><div className="grid gap-3">{filteredPlugins.map(p => (<div key={p.id} className="border rounded-lg p-4 hover:border-primary/50 transition-colors"><div className="flex items-start justify-between"><div className="flex-1"><div className="flex items-center gap-2 mb-1"><h3 className="font-semibold">{p.displayName}</h3>{p.isCrossplay && <span className="text-xs px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded">🎮 Cross-Play</span>}</div><p className="text-sm text-muted-foreground mb-2">{p.description}</p><div className="flex items-center gap-4 text-xs text-muted-foreground"><span>by {p.author}</span><span>v{p.version}</span><span>{(p.downloads / 1000000).toFixed(1)}M downloads</span><span>⭐ {p.rating}</span></div></div><span className="text-xs px-2 py-1 bg-muted rounded whitespace-nowrap">{p.category}</span></div></div>))}</div></div>
          </div>
        </div>
      )}
      
      {/* Server Detail Modal */}
      {selectedServer && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b flex items-center justify-between bg-muted/30">
              <div className="flex items-center gap-3"><Status status={selectedServer.status} /><div><div className="flex items-center gap-2"><h2 className="text-xl font-bold">{selectedServer.name}</h2><Badge edition={selectedServer.edition} /></div><p className="text-sm text-muted-foreground">{selectedServer.serverType} {selectedServer.version}</p></div></div>
              <div className="flex items-center gap-2">
                {selectedServer.status === 'stopped' && <button onClick={() => sendAction('start', { serverId: selectedServer.id })} className="px-4 py-2 bg-green-500 text-white rounded-lg font-medium">Start</button>}
                {selectedServer.status === 'running' && <><button onClick={() => sendAction('restart', { serverId: selectedServer.id })} className="px-4 py-2 bg-yellow-500 text-white rounded-lg">Restart</button><button onClick={() => sendAction('stop', { serverId: selectedServer.id })} className="px-4 py-2 bg-red-500 text-white rounded-lg">Stop</button></>}
                <button onClick={() => setSelectedServer(null)} className="p-2 hover:bg-muted rounded-lg text-xl">×</button>
              </div>
            </div>
            <div className="flex border-b bg-muted/20">{['overview', 'console', 'players', 'files', 'settings'].map(t => (<button key={t} onClick={() => setActiveTab(t as any)} className={`px-5 py-3 font-medium capitalize ${activeTab === t ? 'text-primary border-b-2 border-primary bg-background' : 'text-muted-foreground'}`}>{t}</button>))}</div>
            <div className="flex-1 overflow-y-auto p-4">
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{[['TPS', selectedServer.tps.toFixed(1), 'from-green-500/10'], ['Memory', fmtBytes(selectedServer.memoryUsed * 1024 * 1024), 'from-blue-500/10'], ['CPU', `${selectedServer.cpuUsage.toFixed(0)}%`, 'from-purple-500/10'], ['Uptime', fmtUptime(selectedServer.uptime), 'from-orange-500/10']].map(([l, v, c], i) => <div key={i} className={`bg-gradient-to-br ${c} rounded-xl p-4 border`}><p className="text-sm text-muted-foreground">{l}</p><p className="text-2xl font-bold">{v}</p></div>)}</div>
                  <div className="bg-muted/30 rounded-xl p-4"><h3 className="font-semibold mb-3">Connection Info</h3><div className="grid md:grid-cols-2 gap-4"><div className="bg-background rounded-lg p-3"><p className="text-sm text-muted-foreground">☕ Java Edition</p><p className="font-mono text-lg">localhost:{selectedServer.port}</p></div>{selectedServer.bedrockPort && <div className="bg-background rounded-lg p-3"><p className="text-sm text-muted-foreground">🪨 Bedrock Edition</p><p className="font-mono text-lg">localhost:{selectedServer.bedrockPort}</p></div>}</div></div>
                </div>
              )}
              {activeTab === 'console' && (
                <div className="flex flex-col h-[400px] bg-gray-950 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800"><Badge edition={selectedServer.edition} /><span className="text-sm text-gray-400">Console</span></div>
                  <div className="flex-1 overflow-y-auto p-4 font-mono text-sm text-gray-300">{selectedServer.status === 'running' ? 'Server running... Output will appear here.' : 'Start the server to see console output.'}</div>
                  <form onSubmit={e => { e.preventDefault(); if (command.trim()) { sendAction('command', { serverId: selectedServer.id, command: command.trim() }); setCommand('') } }} className="flex gap-2 p-2 bg-gray-900 border-t border-gray-800"><span className="text-gray-500 font-mono py-2">&gt;</span><input value={command} onChange={e => setCommand(e.target.value)} placeholder="Enter command..." className="flex-1 bg-gray-800 text-gray-100 px-3 py-2 rounded font-mono text-sm border border-gray-700 focus:border-primary focus:outline-none" /><button type="submit" className="px-4 py-2 bg-primary text-primary-foreground rounded font-medium text-sm">Send</button></form>
                </div>
              )}
              {activeTab === 'players' && (
                <div className="space-y-6">
                  <div className="flex gap-3"><input value={playerInput} onChange={e => setPlayerInput(e.target.value)} placeholder="Player name..." className="flex-1 px-4 py-2 bg-background border rounded-lg" /><button onClick={() => { if (playerInput.trim()) { sendAction('whitelist-add', { serverId: selectedServer.id, player: playerInput.trim() }); setPlayerInput('') } }} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg">Add Whitelist</button></div>
                  <div><h3 className="font-semibold mb-3">Online ({selectedServer.playersOnline})</h3><div className="grid gap-2">{selectedServer.playersList.length > 0 ? selectedServer.playersList.map((p, i) => <div key={i} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg"><Badge edition={p.edition || 'java'} /><span className="font-medium">{p.name}</span></div>) : <p className="text-muted-foreground text-center py-4">No players online</p>}</div></div>
                  <div><h3 className="font-semibold mb-3">Whitelist ({selectedServer.whitelistPlayers?.length || 0})</h3><div className="flex flex-wrap gap-2">{(selectedServer.whitelistPlayers || []).map((p, i) => <span key={i} className="px-3 py-1 bg-green-500/10 text-green-500 rounded-full text-sm">{p.name}</span>)}</div></div>
                </div>
              )}
              {activeTab === 'files' && (
                <div className="grid md:grid-cols-2 gap-4 h-[400px]">
                  <div className="bg-muted/30 rounded-lg overflow-hidden"><div className="p-3 border-b"><span className="font-medium">Files</span></div><div className="overflow-y-auto h-[calc(100%-48px)]">{files.length === 0 ? <div className="p-4 text-center text-muted-foreground">Loading...</div> : files.map((f, i) => <div key={i} onClick={() => { if (f.type === 'file' && f.editable) fetchData('file', { serverId: selectedServer.id, path: f.path }).then(d => d?.content && setCurrentFile({ path: f.path, content: d.content })) }} className={`flex items-center gap-3 p-2 hover:bg-muted/50 cursor-pointer ${currentFile?.path === f.path ? 'bg-primary/10' : ''}`}><span>{f.type === 'directory' ? '📁' : '📄'}</span><span className="text-sm">{f.name}</span></div>)}</div></div>
                  <div className="bg-muted/30 rounded-lg overflow-hidden flex flex-col"><div className="p-3 border-b flex items-center justify-between"><span className="font-medium text-sm truncate">{currentFile?.path || 'Select a file'}</span>{currentFile && <button onClick={() => sendAction('file-save', { serverId: selectedServer.id, path: currentFile.path, content: currentFile.content })} className="px-3 py-1 bg-primary text-primary-foreground rounded text-sm">Save</button>}</div>{currentFile ? <textarea value={currentFile.content} onChange={e => setCurrentFile({ ...currentFile, content: e.target.value })} className="flex-1 p-3 bg-background font-mono text-sm resize-none focus:outline-none" /> : <div className="flex-1 flex items-center justify-center text-muted-foreground">Select a file</div>}</div>
                </div>
              )}
              {activeTab === 'settings' && (
                <div className="grid md:grid-cols-2 gap-4">{[['Version', selectedServer.version], ['Type', selectedServer.serverType], ['Game Mode', selectedServer.gamemode], ['Difficulty', selectedServer.difficulty], ['Max Players', selectedServer.maxPlayers], ['Memory', `${selectedServer.maxMemory} MB`], ['Online Mode', selectedServer.onlineMode ? 'Yes' : 'No'], ['Cross-Play', selectedServer.geyserEnabled ? 'Enabled' : 'Disabled']].map(([l, v], i) => <div key={i} className="bg-muted/30 rounded-lg p-4"><p className="text-sm text-muted-foreground">{l}</p><p className="font-semibold capitalize">{v}</p></div>)}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
