import { useState, useRef, useCallback, useEffect } from 'react';

interface Provincia {
  id: string;
  codigo: string;
  nombre: string;
}

interface Municipio {
  cmun: string;
  nombre: string;
}

interface ProcessingResult {
  total: number;
  encontrados: number;
  noEncontrados: number;
  errores: number;
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
  const [provincias, setProvincias] = useState<Provincia[]>([]);
  const [municipios, setMunicipios] = useState<Municipio[]>([]);
  const [selectedProvincia, setSelectedProvincia] = useState('');
  const [selectedMunicipio, setSelectedMunicipio] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check API status
  const checkApiStatus = useCallback(async () => {
    setApiStatus('checking');
    try {
      const response = await fetch(`${apiUrl}/provincias`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      if (response.ok) {
        const data = await response.json();
        setProvincias(data);
        setApiStatus('online');
      } else {
        setApiStatus('offline');
      }
    } catch {
      setApiStatus('offline');
    }
  }, [apiUrl]);

  useEffect(() => {
    checkApiStatus();
  }, [checkApiStatus]);

  // Load municipios when provincia changes
  useEffect(() => {
    if (!selectedProvincia || apiStatus !== 'online') {
      setMunicipios([]);
      return;
    }

    const loadMunicipios = async () => {
      try {
        const response = await fetch(`${apiUrl}/municipios/${selectedProvincia}`);
        if (response.ok) {
          const data = await response.json();
          setMunicipios(data);
        }
      } catch {
        setMunicipios([]);
      }
    };

    loadMunicipios();
  }, [selectedProvincia, apiUrl, apiStatus]);

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
      setResult(null);
      setDownloadUrl(null);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && isValidFile(selectedFile)) {
      setFile(selectedFile);
      setResult(null);
      setDownloadUrl(null);
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

  const removeFile = () => {
    setFile(null);
    setResult(null);
    setDownloadUrl(null);
    setError(null);
    setProgress(0);
    setProgressText('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Format elapsed time
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  };

  // Cleanup intervals on unmount
  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, []);

  // Process file
  const processFile = async () => {
    if (!file || apiStatus !== 'online') return;

    setIsProcessing(true);
    setProgress(0);
    setElapsedTime(0);
    setProgressText('Subiendo archivo...');
    setResult(null);
    setDownloadUrl(null);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);
    if (selectedProvincia) {
      formData.append('filtro_provincia', selectedProvincia);
    }
    if (selectedMunicipio) {
      formData.append('filtro_municipio', selectedMunicipio);
    }

    // Start elapsed time counter
    const startTime = Date.now();
    timerIntervalRef.current = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    // Progress simulation that never stops (slows down after 90%)
    let currentProgress = 0;
    progressIntervalRef.current = setInterval(() => {
      setProgress(prev => {
        if (prev < 30) {
          currentProgress = prev + Math.random() * 8;
        } else if (prev < 60) {
          currentProgress = prev + Math.random() * 5;
        } else if (prev < 85) {
          currentProgress = prev + Math.random() * 2;
        } else if (prev < 95) {
          // Very slow progress after 85%
          currentProgress = prev + Math.random() * 0.5;
        } else {
          // Micro progress to show activity
          currentProgress = Math.min(99, prev + Math.random() * 0.1);
        }
        return Math.min(99, currentProgress);
      });
    }, 500);

    try {
      setProgressText('Procesando direcciones... (esto puede tardar varios minutos)');

      const response = await fetch(`${apiUrl}/procesar-excel`, {
        method: 'POST',
        body: formData,
      });

      // Clear intervals
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);

      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        setDownloadUrl(url);

        // Try to get result stats from headers
        const statsHeader = response.headers.get('X-Processing-Stats');
        const timeHeader = response.headers.get('X-Processing-Time');
        let stats: ProcessingResult | null = null;

        if (statsHeader) {
          try {
            const rawStats = JSON.parse(statsHeader);
            console.log('Stats from API:', rawStats);
            // Usar ?? en lugar de || para que 0 no se trate como falso
            stats = {
              total: rawStats.procesadas ?? 0,
              encontrados: rawStats.encontradas ?? 0,
              noEncontrados: rawStats.no_encontradas ?? 0,
              errores: rawStats.errores ?? 0
            };
          } catch (e) {
            console.warn('Could not parse stats header:', statsHeader);
          }
        }

        setProgress(100);
        const timeText = timeHeader || formatTime(Math.floor((Date.now() - startTime) / 1000));
        setProgressText(`Completado en ${timeText}`);

        // Use stats from header or show message
        if (stats) {
          setResult(stats);
        } else {
          setResult({
            total: 0,
            encontrados: 0,
            noEncontrados: 0,
            errores: 0
          });
        }
      } else {
        // Handle error response
        let errorDetails = '';
        let errorData: any = null;

        try {
          const contentType = response.headers.get('content-type');
          if (contentType?.includes('application/json')) {
            errorData = await response.json();
            errorDetails = JSON.stringify(errorData, null, 2);
          } else {
            errorDetails = await response.text();
          }
        } catch {
          errorDetails = 'No se pudo leer la respuesta del servidor';
        }

        console.error('API Error:', {
          status: response.status,
          statusText: response.statusText,
          details: errorDetails
        });

        setError({
          message: errorData?.detail || errorData?.message || `Error ${response.status}: ${response.statusText}`,
          status: response.status,
          details: errorDetails
        });
        setProgress(0);
        setProgressText('');
      }
    } catch (err) {
      // Clear intervals
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);

      const errorMessage = err instanceof Error ? err.message : 'Error desconocido';
      console.error('Fetch Error:', err);

      setError({
        message: `Error de conexion: ${errorMessage}`,
        details: err instanceof Error ? err.stack : undefined
      });
      setProgress(0);
      setProgressText('');
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadFile = () => {
    if (downloadUrl) {
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `geocodificado_${file?.name || 'resultado.xlsx'}`;
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

          {/* Filters */}
          <div className="card fade-in stagger-1">
            <div className="card-title">
              <div className="card-title-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                </svg>
              </div>
              Filtros (Opcional)
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Provincia</label>
                <select
                  className="form-select"
                  value={selectedProvincia}
                  onChange={(e) => {
                    setSelectedProvincia(e.target.value);
                    setSelectedMunicipio('');
                  }}
                  disabled={apiStatus !== 'online'}
                >
                  <option value="">Todas las provincias</option>
                  {provincias.map(p => (
                    <option key={p.id} value={p.nombre}>{p.nombre}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Municipio</label>
                <select
                  className="form-select"
                  value={selectedMunicipio}
                  onChange={(e) => setSelectedMunicipio(e.target.value)}
                  disabled={!selectedProvincia || municipios.length === 0}
                >
                  <option value="">Todos los municipios</option>
                  {municipios.map(m => (
                    <option key={m.cmun} value={m.nombre}>{m.nombre}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* File Upload */}
          <div className="card fade-in stagger-2">
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
                <button className="file-remove" onClick={removeFile}>
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

            {/* Progress */}
            {isProcessing && (
              <div className="progress-container">
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${progress}%` }}></div>
                </div>
                <div className="progress-text">
                  <span className="progress-status">{progressText}</span>
                  <span style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <span style={{ color: '#666', fontSize: '0.85rem' }}>
                      Tiempo: {formatTime(elapsedTime)}
                    </span>
                    <span>{Math.round(progress)}%</span>
                  </span>
                </div>
              </div>
            )}

            {/* Error Display */}
            {error && (
              <div className="error-container" style={{
                marginTop: '1.5rem',
                padding: '1rem',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '8px'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  color: '#dc2626',
                  fontWeight: 600,
                  marginBottom: '0.5rem'
                }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  Error {error.status && `(${error.status})`}
                </div>
                <p style={{ color: '#991b1b', margin: '0 0 0.5rem 0' }}>{error.message}</p>
                {error.details && (
                  <details style={{ marginTop: '0.5rem' }}>
                    <summary style={{
                      cursor: 'pointer',
                      color: '#666',
                      fontSize: '0.85rem',
                      userSelect: 'none'
                    }}>
                      Ver detalles tecnicos
                    </summary>
                    <pre style={{
                      marginTop: '0.5rem',
                      padding: '0.75rem',
                      backgroundColor: '#fff',
                      border: '1px solid #e5e5e5',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      overflow: 'auto',
                      maxHeight: '200px',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all'
                    }}>
                      {error.details}
                    </pre>
                  </details>
                )}
                <button
                  onClick={() => setError(null)}
                  style={{
                    marginTop: '0.75rem',
                    padding: '0.5rem 1rem',
                    backgroundColor: '#dc2626',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '0.85rem'
                  }}
                >
                  Cerrar
                </button>
              </div>
            )}
          </div>

          {/* Results */}
          {result && (
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
                  <div className="result-stat-label">Total</div>
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
