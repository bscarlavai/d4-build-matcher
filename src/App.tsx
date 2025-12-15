import { useState, useRef } from 'react';
import type { PlayerClass, UserGear, BuildMatch, Build } from './types';
import { parseItem } from './api/parseItem';
import { matchBuilds } from './api/matchBuilds';

type AppState = 'select-class' | 'inventory' | 'camera' | 'results';

interface CaptureViewProps {
  onCapture: (imageBase64: string) => Promise<void>;
  onCancel: () => void;
}

function CaptureView({ onCapture, onCancel }: CaptureViewProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    // Check if HEIC (browsers may report different types)
    const isHeic = file.type === 'image/heic' ||
                   file.type === 'image/heif' ||
                   file.name.toLowerCase().endsWith('.heic') ||
                   file.name.toLowerCase().endsWith('.heif');

    if (isHeic) {
      setError('HEIC files are not supported. Please convert to JPG or PNG first.');
      return;
    }
    setError(null);

    // Load image and re-encode as JPEG via canvas, resizing if needed
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;

      const img = new Image();
      img.onload = () => {
        // Resize if too large (max 2000px on longest side for reasonable file size)
        const MAX_SIZE = 2000;
        let width = img.width;
        let height = img.height;

        if (width > MAX_SIZE || height > MAX_SIZE) {
          if (width > height) {
            height = Math.round((height * MAX_SIZE) / width);
            width = MAX_SIZE;
          } else {
            width = Math.round((width * MAX_SIZE) / height);
            height = MAX_SIZE;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        // Use 0.85 quality to keep under 5MB limit
        const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.85);
        setPreview(jpegDataUrl);
      };
      img.onerror = () => {
        setPreview(dataUrl);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      processFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setIsProcessing(true);
    setError(null);
    try {
      // Extract base64 data (remove "data:image/...;base64," prefix)
      const base64 = preview.split(',')[1];
      await onCapture(base64);
    } catch (err) {
      console.error('Capture failed:', err);
      const message = err instanceof Error ? err.message : 'Failed to process image';
      setError(message);
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      <div className="flex-1 flex items-center justify-center overflow-hidden">
        <div className="text-center p-4 w-full max-w-md">
          {preview ? (
            <div className="mb-4">
              <img
                src={preview}
                alt="Preview"
                className="max-h-96 mx-auto rounded-lg border border-gray-700"
              />
            </div>
          ) : (
            <div
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`border-2 border-dashed rounded-lg h-96 flex flex-col items-center justify-center mb-4 mx-auto cursor-pointer transition-colors ${
                isDragging
                  ? 'border-red-500 bg-red-500/10'
                  : 'border-gray-600 hover:border-gray-500'
              }`}
            >
              <svg className="w-12 h-12 text-gray-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-gray-400 mb-2">
                {isDragging ? 'Drop image here' : 'Tap to upload screenshot'}
              </p>
              <p className="text-gray-600 text-sm">or drag and drop (JPG/PNG)</p>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />

          {!preview && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-3 bg-red-600 hover:bg-red-700 rounded-lg font-medium mb-3"
            >
              Choose Screenshot
            </button>
          )}
        </div>
      </div>

      <div className="p-4 bg-gray-900 space-y-3">
        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}
        {preview && (
          <div className="flex gap-3">
            <button
              onClick={() => { setPreview(null); setError(null); }}
              className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium"
            >
              Retake
            </button>
            <button
              onClick={handleConfirm}
              disabled={isProcessing}
              className="flex-1 py-3 bg-red-600 hover:bg-red-700 rounded-lg font-medium disabled:opacity-50"
            >
              {isProcessing ? 'Processing...' : 'Use This Image'}
            </button>
          </div>
        )}
        <button
          onClick={onCancel}
          className="w-full py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-medium text-gray-400"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

const CLASSES: { id: PlayerClass; name: string }[] = [
  { id: 'paladin', name: 'Paladin' },
  { id: 'barbarian', name: 'Barbarian' },
  { id: 'druid', name: 'Druid' },
  { id: 'necromancer', name: 'Necromancer' },
  { id: 'rogue', name: 'Rogue' },
  { id: 'sorcerer', name: 'Sorcerer' },
  { id: 'spiritborn', name: 'Spiritborn' },
];

function App() {
  const [appState, setAppState] = useState<AppState>('select-class');
  const [playerClass, setPlayerClass] = useState<PlayerClass | null>(null);
  const [gear, setGear] = useState<UserGear>({});
  const [buildMatches, setBuildMatches] = useState<BuildMatch[] | null>(null);

  const handleClassSelect = (cls: PlayerClass) => {
    setPlayerClass(cls);
    setAppState('inventory');
  };

  const gearCount = Object.values(gear).flat().length;

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-red-500">D4 Build Matcher</h1>
          {playerClass && (
            <button
              onClick={() => {
                setAppState('select-class');
                setPlayerClass(null);
                setGear({});
                setBuildMatches(null);
              }}
              className="text-sm text-gray-400 hover:text-white"
            >
              Change Class
            </button>
          )}
        </div>
      </header>

      {/* Class Selection */}
      {appState === 'select-class' && (
        <div className="p-4">
          <h2 className="text-lg font-semibold mb-4 text-center">Select Your Class</h2>
          <div className="grid grid-cols-2 gap-3 max-w-md mx-auto">
            {CLASSES.map((cls) => (
              <button
                key={cls.id}
                onClick={() => handleClassSelect(cls.id)}
                disabled={cls.id !== 'paladin'}
                className={`p-4 rounded-lg font-medium transition-colors ${
                  cls.id === 'paladin'
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                }`}
              >
                {cls.name}
                {cls.id !== 'paladin' && (
                  <span className="block text-xs mt-1">Coming Soon</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Gear Inventory */}
      {appState === 'inventory' && (
        <div className="p-4">
          <div className="text-center mb-6">
            <p className="text-gray-400 mb-2">
              Playing as <span className="text-red-400 font-semibold capitalize">{playerClass}</span>
            </p>
            <p className="text-sm text-gray-500">
              {gearCount === 0
                ? 'Scan your gear to get started'
                : `${gearCount} item${gearCount !== 1 ? 's' : ''} scanned`}
            </p>
          </div>

          <div className="flex flex-col gap-3 max-w-md mx-auto">
            <button
              onClick={() => setAppState('camera')}
              className="w-full py-4 bg-red-600 hover:bg-red-700 rounded-lg font-bold text-lg transition-colors"
            >
              Scan Gear
            </button>

            {gearCount > 0 && (
              <button
                onClick={async () => {
                  try {
                    // Fetch build data for the player's class
                    const indexRes = await fetch(`/data/builds/${playerClass}/index.json`);
                    const index = await indexRes.json();

                    // Fetch all builds
                    const builds: Build[] = await Promise.all(
                      index.builds.map(async (b: { file: string }) => {
                        const res = await fetch(`/data/builds/${playerClass}/${b.file}`);
                        return res.json();
                      })
                    );

                    // Run matching algorithm
                    const matches = matchBuilds(gear, builds);
                    setBuildMatches(matches);
                    setAppState('results');
                  } catch (err) {
                    console.error('Failed to match builds:', err);
                  }
                }}
                className="w-full py-4 bg-gray-700 hover:bg-gray-600 rounded-lg font-bold text-lg transition-colors"
              >
                Find Matching Builds
              </button>
            )}
          </div>

          {/* Gear List Preview */}
          {gearCount > 0 && (
            <div className="mt-6 max-w-md mx-auto">
              <h3 className="text-sm font-semibold text-gray-400 mb-2">Scanned Items</h3>
              <div className="space-y-2">
                {Object.entries(gear).map(([slot, items]) =>
                  items.map((item, idx) => (
                    <div
                      key={`${slot}-${idx}`}
                      className="bg-gray-800 rounded-lg p-3 flex justify-between items-center"
                    >
                      <div>
                        <p className="font-medium">{item.name}</p>
                        <p className="text-sm text-gray-400 capitalize">{item.type}</p>
                      </div>
                      <button
                        onClick={() => {
                          setGear((prev) => ({
                            ...prev,
                            [slot]: prev[slot].filter((_, i) => i !== idx),
                          }));
                        }}
                        className="text-gray-500 hover:text-red-400"
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Camera View */}
      {appState === 'camera' && (
        <CaptureView
          onCapture={async (imageBase64) => {
            const item = await parseItem(imageBase64, playerClass!);
            setGear((prev) => ({
              ...prev,
              [item.type]: [...(prev[item.type] || []), item],
            }));
            setAppState('inventory');
          }}
          onCancel={() => setAppState('inventory')}
        />
      )}

      {/* Results View */}
      {appState === 'results' && (
        <div className="p-4">
          <div className="text-center mb-6">
            <h2 className="text-lg font-semibold mb-2">Build Matches</h2>
            <p className="text-sm text-gray-400">Based on your {gearCount} scanned item{gearCount !== 1 ? 's' : ''}</p>
          </div>

          <div className="max-w-md mx-auto space-y-4">
            {buildMatches && buildMatches.length > 0 ? (
              buildMatches.map((match) => (
                <div key={match.buildId} className="bg-gray-800 rounded-lg p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className="font-semibold text-white">{match.buildName}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        match.tier === 'S' ? 'bg-yellow-600' :
                        match.tier === 'A' ? 'bg-purple-600' :
                        match.tier === 'B' ? 'bg-blue-600' : 'bg-gray-600'
                      }`}>
                        {match.tier} Tier
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-red-400">{match.percentage}%</div>
                      <div className="text-xs text-gray-500">match</div>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full bg-gray-700 rounded-full h-2 mb-3">
                    <div
                      className="bg-red-500 h-2 rounded-full transition-all"
                      style={{ width: `${match.percentage}%` }}
                    />
                  </div>

                  {/* Missing critical items */}
                  {match.missingCritical.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs text-gray-500 mb-1">Missing key items:</p>
                      <div className="flex flex-wrap gap-1">
                        {match.missingCritical.slice(0, 3).map((item, i) => (
                          <span key={i} className="text-xs bg-red-900/50 text-red-300 px-2 py-0.5 rounded">
                            {item.item.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Slot breakdown */}
                  <details className="text-sm">
                    <summary className="text-gray-400 cursor-pointer hover:text-gray-300">
                      View slot details
                    </summary>
                    <div className="mt-2 space-y-1">
                      {Object.entries(match.recommendedLoadout).map(([slot, info]) => (
                        <div key={slot} className="flex justify-between text-xs">
                          <span className="text-gray-500 capitalize">{slot}</span>
                          <span className={info.item ? 'text-gray-300' : 'text-gray-600'}>
                            {info.item ? info.notes : 'No item'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>

                  {/* Link to guide */}
                  <a
                    href={match.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 block text-center text-sm text-red-400 hover:text-red-300"
                  >
                    View Full Guide →
                  </a>
                </div>
              ))
            ) : (
              <div className="bg-gray-800 rounded-lg p-4 text-center">
                <p className="text-gray-400">No builds found</p>
              </div>
            )}
          </div>

          <div className="mt-6 max-w-md mx-auto">
            <button
              onClick={() => setAppState('inventory')}
              className="w-full py-3 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium"
            >
              Back to Inventory
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
