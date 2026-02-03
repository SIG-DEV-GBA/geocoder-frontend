import { useState, useRef, useEffect } from 'react';

interface ProcessingResult {
  total: number;
  encontrados: number;
  noEncontrados: number;
  errores: number;
}

interface LogEntry {
  id: number;
  type: 'info' | 'found' | 'not_found' | 'error' | 'complete';
  row?: number;
  direccion?: string;
  municipio?: string;
  cp?: string;
  message?: string;
  timestamp: Date;
}

interface ApiError {
  message: string;
  status?: number;
  details?: string;
}

type ApiStatus = 'checking' | 'online' | 'offline';

export default function GeocoderApp() {
  // State
  const [apiUrl, setApiUrl] = useState('https://apicp.si-erp.cloud');
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalRows, setTotalRows] = useState(0);
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadFilename, setDownloadFilename] = useState<string>('resultado.xlsx');
  const [error, setError] = useState<ApiError | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [showLog, setShowLog] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logIdRef = useRef(0);

  // Check API status
  const checkApiStatus = async () => {
    setApiStatus('checking');
    try {
      const response = await fetch(`${apiUrl}/`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      if (response.ok) {
        setApiStatus('online');
      } else {
        setApiStatus('offline');
      }
    } catch {
      setApiStatus('offline');
    }
  };

  useEffect(() => {
    checkApiStatus();
  }, [apiUrl]);

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logEntries]);

  // File handling
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && isValidFile(droppedFile)) {
      setFile(droppedFile);
      resetState();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && isValidFile(selectedFile)) {
      setFile(selectedFile);
      resetState();
    }
  };

  const isValidFile = (file: File) => {
    const validExtensions = ['.xlsx', '.xls', '.xlsm'];
    return validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const resetState = () => {
    setResult(null);
    setDownloadUrl(null);
    setError(null);
    setProgress(0);
    setTotalRows(0);
    setLogEntries([]);
    setShowLog(false);
  };

  const removeFile = () => {
    setFile(null);
    resetState();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  const addLogEntry = (entry: Omit<LogEntry, 'id' | 'timestamp'>) => {
    logIdRef.current += 1;
    setLogEntries(prev => [...prev, { ...entry, id: logIdRef.current, timestamp: new Date() }]);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, []);

  // Process file with SSE
  const processFile = async () => {
    if (!file || apiStatus !== 'online') return;

    setIsProcessing(true);
    setProgress(0);
    setElapsedTime(0);
    setTotalRows(0);
    setResult(null);
    setDownloadUrl(null);
    setError(null);
    setLogEntries([]);
    setShowLog(true);
    logIdRef.current = 0;

    const formData = new FormData();
    formData.append('file', file);

    // Start timer
    const startTime = Date.now();
    timerIntervalRef.current = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    addLogEntry({ type: 'info', message: `Iniciando procesamiento de ${file.name}...` });

    try {
      const response = await fetch(`${apiUrl}/procesar-excel-stream`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No se pudo leer la respuesta');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (value) {
          buffer += decoder.decode(value, { stream: true });
        }

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              handleSSEEvent(data);
            } catch (e) {
              console.warn('Error parsing SSE:', e);
            }
          }
        }

        if (done) {
          // Procesar cualquier dato restante en el buffer
          if (buffer.startsWith('data: ')) {
            try {
              const data = JSON.parse(buffer.slice(6));
              handleSSEEvent(data);
            } catch (e) {
              console.warn('Error parsing final SSE:', e);
            }
          }
          break;
        }
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error desconocido';
      addLogEntry({ type: 'error', message: `Error: ${errorMessage}` });
      setError({ message: errorMessage });
    } finally {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      setIsProcessing(false);
    }
  };

  const handleSSEEvent = (data: any) => {
    switch (data.type) {
      case 'start':
        setTotalRows(data.total);
        addLogEntry({ type: 'info', message: `Archivo cargado: ${data.total} filas detectadas` });
        break;

      case 'progress':
        setProgress(Math.round((data.stats.procesadas / data.total) * 100));
        addLogEntry({
          type: data.status === 'found' ? 'found' : 'not_found',
          row: data.row,
          direccion: data.direccion,
          municipio: data.municipio,
          cp: data.cp
        });
        break;

      case 'row_error':
        addLogEntry({ type: 'error', row: data.row, message: data.error });
        break;

      case 'error':
        addLogEntry({ type: 'error', message: data.message });
        setError({ message: data.message });
        break;

      case 'complete':
        setProgress(100);
        setResult({
          total: data.stats.procesadas,
          encontrados: data.stats.encontradas,
          noEncontrados: data.stats.no_encontradas,
          errores: data.stats.errores
        });
        addLogEntry({ type: 'complete', message: `Completado en ${data.elapsed}` });

        // Create download URL from base64
        if (data.file) {
          const byteCharacters = atob(data.file);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          setDownloadUrl(URL.createObjectURL(blob));
          setDownloadFilename(data.filename);
        }
        break;
    }
  };

  const downloadFile = () => {
    if (downloadUrl) {
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = downloadFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="app-wrapper">
      {/* Header */}
      <header className="header">
        <div className="container">
          <div className="header-content">
            <h1>Geocoder CP</h1>
            <p>Obtener Codigos Postales de direcciones en Excel</p>
            <div className="header-badge">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              API GeoAPI.es
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        <div className="container">
          {/* API Configuration */}
          <div className="card fade-in">
            <div className="card-title">
              <div className="card-title-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                </svg>
              </div>
              Configuracion de API
            </div>

            <div className="api-config">
              <input
                type="text"
                className="form-input"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="URL de la API"
              />
              <button className="btn btn-secondary" onClick={checkApiStatus}>
                Verificar
              </button>
              <div className="status-indicator">
                <span className={`status-dot ${apiStatus}`}></span>
                {apiStatus === 'online' ? 'Conectado' : apiStatus === 'checking' ? 'Verificando...' : 'Desconectado'}
              </div>
            </div>
          </div>

          {/* File Upload */}
          <div className="card fade-in stagger-1">
            <div className="card-title">
              <div className="card-title-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="12" y1="18" x2="12" y2="12"/>
                  <line x1="9" y1="15" x2="15" y2="15"/>
                </svg>
              </div>
              Archivo Excel
            </div>

            <div
              className={`dropzone ${isDragging ? 'active' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="dropzone-content">
                <svg className="dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <p className="dropzone-text">
                  Arrastra tu archivo aqui o <strong>haz clic para seleccionar</strong>
                </p>
                <p className="dropzone-hint">Formatos soportados: .xlsx, .xls, .xlsm</p>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.xlsm"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />

            {file && (
              <div className="file-info">
                <svg className="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <path d="M9 15l2 2 4-4"/>
                </svg>
                <div className="file-details">
                  <div className="file-name">{file.name}</div>
                  <div className="file-size">{formatFileSize(file.size)}</div>
                </div>
                <button className="file-remove" onClick={removeFile} disabled={isProcessing}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            )}

            {/* Process Button */}
            <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
              <button
                className="btn btn-primary"
                onClick={processFile}
                disabled={!file || apiStatus !== 'online' || isProcessing}
              >
                {isProcessing ? (
                  <>
                    <span className="spinner"></span>
                    Procesando...
                  </>
                ) : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                    Procesar Archivo
                  </>
                )}
              </button>
            </div>

            {/* Progress Bar */}
            {(isProcessing || progress > 0) && (
              <div className="progress-container">
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${progress}%` }}></div>
                </div>
                <div className="progress-text">
                  <span className="progress-status">
                    {isProcessing ? `Procesando... ${totalRows > 0 ? `(${totalRows} filas)` : ''}` : 'Completado'}
                  </span>
                  <span style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <span style={{ color: '#666', fontSize: '0.85rem' }}>
                      Tiempo: {formatTime(elapsedTime)}
                    </span>
                    <span>{progress}%</span>
                  </span>
                </div>
              </div>
            )}

            {/* Error Display */}
            {error && !isProcessing && (
              <div className="error-container" style={{
                marginTop: '1.5rem',
                padding: '1rem',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '8px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#dc2626', fontWeight: 600 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  Error
                </div>
                <p style={{ color: '#991b1b', margin: '0.5rem 0 0' }}>{error.message}</p>
              </div>
            )}
          </div>

          {/* Live Log Terminal */}
          {showLog && (
            <div className="card fade-in" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="terminal-header">
                <div className="terminal-dots">
                  <span className="dot red"></span>
                  <span className="dot yellow"></span>
                  <span className="dot green"></span>
                </div>
                <span className="terminal-title">Procesamiento en Tiempo Real</span>
                <span className="terminal-stats">
                  {logEntries.filter(e => e.type === 'found').length} encontrados · {logEntries.filter(e => e.type === 'not_found').length} no encontrados
                </span>
              </div>
              <div className="terminal-body" ref={logContainerRef}>
                {logEntries.map((entry, idx) => (
                  <div
                    key={entry.id}
                    className={`log-entry log-${entry.type}`}
                    style={{ animationDelay: `${Math.min(idx * 0.02, 0.5)}s` }}
                  >
                    <span className="log-time">
                      {entry.timestamp.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    {entry.type === 'info' && (
                      <>
                        <span className="log-badge info">INFO</span>
                        <span className="log-message">{entry.message}</span>
                      </>
                    )}
                    {entry.type === 'found' && (
                      <>
                        <span className="log-badge found">CP {entry.cp}</span>
                        <span className="log-row">#{entry.row}</span>
                        <span className="log-direccion">{entry.direccion}</span>
                        <span className="log-municipio">{entry.municipio}</span>
                      </>
                    )}
                    {entry.type === 'not_found' && (
                      <>
                        <span className="log-badge not-found">NO ENCONTRADO</span>
                        <span className="log-row">#{entry.row}</span>
                        <span className="log-direccion">{entry.direccion}</span>
                        <span className="log-municipio">{entry.municipio}</span>
                      </>
                    )}
                    {entry.type === 'error' && (
                      <>
                        <span className="log-badge error">ERROR</span>
                        {entry.row && <span className="log-row">#{entry.row}</span>}
                        <span className="log-message">{entry.message}</span>
                      </>
                    )}
                    {entry.type === 'complete' && (
                      <>
                        <span className="log-badge complete">COMPLETADO</span>
                        <span className="log-message">{entry.message}</span>
                      </>
                    )}
                  </div>
                ))}
                {isProcessing && (
                  <div className="log-entry log-processing">
                    <span className="log-cursor"></span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Results */}
          {result && !isProcessing && (
            <div className="card fade-in">
              <div className="card-title">
                <div className="card-title-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                </div>
                Resultados
              </div>

              <div className="results-summary">
                <div className="result-stat">
                  <div className="result-stat-value">{result.total}</div>
                  <div className="result-stat-label">Procesadas</div>
                </div>
                <div className="result-stat success">
                  <div className="result-stat-value">{result.encontrados}</div>
                  <div className="result-stat-label">Encontrados</div>
                </div>
                <div className="result-stat">
                  <div className="result-stat-value">{result.noEncontrados}</div>
                  <div className="result-stat-label">No encontrados</div>
                </div>
                <div className="result-stat error">
                  <div className="result-stat-value">{result.errores}</div>
                  <div className="result-stat-label">Errores</div>
                </div>
              </div>

              <div style={{ textAlign: 'center' }}>
                <button className="btn btn-success" onClick={downloadFile}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Descargar Excel
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="footer">
        <p>Geocoder CP - Powered by <a href="https://www.geoapi.es" target="_blank" rel="noopener">GeoAPI.es</a></p>
      </footer>
    </div>
  );
}
