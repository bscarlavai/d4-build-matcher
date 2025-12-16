import { useState, useRef, useEffect } from 'react';
import type { PlayerClass, UserGear, BuildMatch, Build } from './types';
import { parseItem } from './api/parseItem';
import { matchBuilds, scoreItemForSlot } from './api/matchBuilds';
import type { ScoredItem } from './api/matchBuilds';
import { parseComparison } from './api/parseComparison';
import type { ComparisonResult } from './api/parseComparison';

type AppState = 'select-class' | 'inventory' | 'camera' | 'results' | 'compare-result';
type ScanMode = 'item' | 'compare';

interface CaptureViewProps {
  mode: ScanMode;
  onCapture: (imageBase64: string) => Promise<void>;
  onComplete: () => void;
  onCancel: () => void;
}

function CaptureView({ mode, onCapture, onComplete, onCancel }: CaptureViewProps) {
  const isCompareMode = mode === 'compare';
  const [previews, setPreviews] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = (file: File): Promise<string | null> => {
    return new Promise((resolve) => {
      // Check if HEIC (browsers may report different types)
      const isHeic = file.type === 'image/heic' ||
                     file.type === 'image/heif' ||
                     file.name.toLowerCase().endsWith('.heic') ||
                     file.name.toLowerCase().endsWith('.heif');

      if (isHeic) {
        resolve(null);
        return;
      }

      // Load image and re-encode as JPEG via canvas, resizing if needed
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;

        const img = new Image();
        img.onload = () => {
          // Resize to reduce token usage (1024px max per Claude's recommendation)
          const MAX_SIZE = 1024;
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

          // Use 0.80 quality to reduce token usage while maintaining readability
          const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.80);
          resolve(jpegDataUrl);
        };
        img.onerror = () => {
          resolve(dataUrl);
        };
        img.src = dataUrl;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  };

  const processFiles = async (files: FileList) => {
    setError(null);
    const newPreviews: string[] = [];
    let heicCount = 0;

    // In compare mode, only allow 1 image
    const filesToProcess = isCompareMode ? [Array.from(files)[0]] : Array.from(files);

    for (const file of filesToProcess) {
      if (!file) continue;
      if (file.type.startsWith('image/') || file.name.match(/\.(jpg|jpeg|png|gif|webp|heic|heif)$/i)) {
        const isHeic = file.type === 'image/heic' ||
                       file.type === 'image/heif' ||
                       file.name.toLowerCase().endsWith('.heic') ||
                       file.name.toLowerCase().endsWith('.heif');
        if (isHeic) {
          heicCount++;
          continue;
        }
        const preview = await processFile(file);
        if (preview) {
          newPreviews.push(preview);
        }
      }
    }

    if (heicCount > 0) {
      setError(`${heicCount} HEIC file(s) skipped. Please convert to JPG or PNG.`);
    }

    // In compare mode, replace instead of append
    if (isCompareMode) {
      setPreviews(newPreviews);
    } else {
      setPreviews((prev) => [...prev, ...newPreviews]);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await processFiles(files);
    }
    // Reset input so same files can be selected again
    e.target.value = '';
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await processFiles(files);
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

  const removePreview = (index: number) => {
    setPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleConfirm = async () => {
    if (previews.length === 0) return;
    setIsProcessing(true);
    setProcessedCount(0);
    setError(null);

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < previews.length; i++) {
      try {
        // Extract base64 data (remove "data:image/...;base64," prefix)
        const base64 = previews[i].split(',')[1];
        await onCapture(base64);
        successCount++;
        setProcessedCount(i + 1);
      } catch (err) {
        console.error('Capture failed:', err);
        errorCount++;
        setProcessedCount(i + 1);
      }
    }

    setIsProcessing(false);

    if (errorCount > 0 && successCount > 0) {
      setError(`${errorCount} image(s) failed to process. ${successCount} succeeded.`);
    } else if (errorCount > 0) {
      setError(`All ${errorCount} image(s) failed to process`);
    } else {
      // All succeeded - navigate back
      onComplete();
    }
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      <div className="flex-1 flex items-center justify-center overflow-auto">
        <div className="text-center p-4 w-full max-w-lg">
          {previews.length > 0 ? (
            <div className="mb-4">
              <p className="text-gray-400 mb-3">{previews.length} image{previews.length !== 1 ? 's' : ''} selected</p>
              <div className="grid grid-cols-3 gap-2 max-h-80 overflow-auto">
                {previews.map((preview, index) => (
                  <div key={index} className="relative group">
                    <img
                      src={preview}
                      alt={`Preview ${index + 1}`}
                      className="w-full h-24 object-cover rounded-lg border border-gray-700"
                    />
                    <button
                      onClick={() => removePreview(index)}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-600 hover:bg-red-700 rounded-full text-white text-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 text-sm text-gray-400 hover:text-white"
              >
                + Add more images
              </button>
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
                {isDragging ? 'Drop image here' : isCompareMode ? 'Tap to upload comparison screenshot' : 'Tap to upload screenshots'}
              </p>
              <p className="text-gray-600 text-sm">
                {isCompareMode ? 'Screenshot showing both items side by side' : 'Select multiple images (JPG/PNG)'}
              </p>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple={!isCompareMode}
            onChange={handleFileSelect}
            className="hidden"
          />

          {previews.length === 0 && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-3 bg-red-600 hover:bg-red-700 rounded-lg font-medium mb-3"
            >
              {isCompareMode ? 'Choose Comparison Screenshot' : 'Choose Screenshots'}
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
        {previews.length > 0 && (
          <div className="flex gap-3">
            <button
              onClick={() => { setPreviews([]); setError(null); }}
              disabled={isProcessing}
              className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium disabled:opacity-50"
            >
              Clear All
            </button>
            <button
              onClick={handleConfirm}
              disabled={isProcessing}
              className="flex-1 py-3 bg-red-600 hover:bg-red-700 rounded-lg font-medium disabled:opacity-50"
            >
              {isProcessing
                ? (isCompareMode ? 'Analyzing...' : `Processing ${processedCount}/${previews.length}...`)
                : (isCompareMode ? 'Compare Items' : `Process ${previews.length} Image${previews.length !== 1 ? 's' : ''}`)}
            </button>
          </div>
        )}
        <button
          onClick={onCancel}
          disabled={isProcessing}
          className="w-full py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-medium text-gray-400 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

const CLASSES: { id: PlayerClass; name: string }[] = [
  { id: 'barbarian', name: 'Barbarian' },
  { id: 'druid', name: 'Druid' },
  { id: 'necromancer', name: 'Necromancer' },
  { id: 'paladin', name: 'Paladin' },
  { id: 'rogue', name: 'Rogue' },
  { id: 'sorcerer', name: 'Sorcerer' },
  { id: 'spiritborn', name: 'Spiritborn' },
];

interface ComparisonAnalysis {
  comparison: ComparisonResult;
  newItemScore: ScoredItem;
  equippedScore: ScoredItem;
  recommendation: 'equip' | 'keep';
  reasons: string[];
  profileUsed: string;
}

function App() {
  const [appState, setAppState] = useState<AppState>('select-class');
  const [playerClass, setPlayerClass] = useState<PlayerClass | null>(null);
  const [gear, setGear] = useState<UserGear>({});
  const [buildMatches, setBuildMatches] = useState<BuildMatch[] | null>(null);
  const [scanMode, setScanMode] = useState<ScanMode>('item');
  const [selectedBuild, setSelectedBuild] = useState<Build | null>(null);
  const [availableBuilds, setAvailableBuilds] = useState<Build[]>([]);
  const [comparisonAnalysis, setComparisonAnalysis] = useState<ComparisonAnalysis | null>(null);

  // Load builds when class is selected
  useEffect(() => {
    if (playerClass) {
      loadBuildsForClass(playerClass);
    }
  }, [playerClass]);

  const loadBuildsForClass = async (cls: PlayerClass) => {
    try {
      const indexRes = await fetch(`/data/builds/endgame/${cls}/index.json`);
      const index = await indexRes.json();
      const builds: Build[] = await Promise.all(
        index.builds.map(async (b: { file: string }) => {
          const res = await fetch(`/data/builds/endgame/${cls}/${b.file}`);
          return res.json();
        })
      );
      // Sort alphabetically by name
      builds.sort((a, b) => a.name.localeCompare(b.name));
      setAvailableBuilds(builds);
    } catch (err) {
      console.error('Failed to load builds:', err);
    }
  };

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
                className="p-4 rounded-lg font-medium transition-colors bg-red-600 hover:bg-red-700 text-white"
              >
                {cls.name}
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

          {/* Build Selection */}
          <div className="max-w-md mx-auto mb-4">
            <label className="block text-sm text-gray-400 mb-2">Your Build (for gear comparison)</label>
            <select
              value={selectedBuild?.id || ''}
              onChange={(e) => {
                const build = availableBuilds.find(b => b.id === e.target.value);
                setSelectedBuild(build || null);
              }}
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-red-500"
            >
              <option value="">Select a build...</option>
              {availableBuilds.map(build => (
                <option key={build.id} value={build.id}>
                  {build.name} ({build.tier} Tier)
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-3 max-w-md mx-auto">
            <button
              onClick={() => {
                setScanMode('item');
                setAppState('camera');
              }}
              className="w-full py-4 bg-red-600 hover:bg-red-700 rounded-lg font-bold text-lg transition-colors"
            >
              Scan Gear
            </button>

            {selectedBuild && (
              <button
                onClick={() => {
                  setScanMode('compare');
                  setAppState('camera');
                }}
                className="w-full py-4 bg-purple-600 hover:bg-purple-700 rounded-lg font-bold text-lg transition-colors"
              >
                Compare Items
              </button>
            )}

            {gearCount > 0 && (
              <button
                onClick={async () => {
                  // Run matching algorithm with already-loaded builds
                  const matches = matchBuilds(gear, availableBuilds);
                  setBuildMatches(matches);
                  setAppState('results');
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
          mode={scanMode}
          onCapture={async (imageBase64) => {
            if (scanMode === 'compare') {
              // Parse comparison screenshot
              const comparison = await parseComparison(imageBase64);

              // Get the slot requirements from the selected build
              // Use the best available profile (mythic > sanctified > ancestral > starter)
              const profilePriority = ['mythic', 'sanctified', 'ancestral', 'starter'];
              const availableProfiles = selectedBuild!.profile_order;
              const bestProfileKey = profilePriority.find(p => availableProfiles.includes(p)) || availableProfiles[0];
              const profile = selectedBuild!.profiles[bestProfileKey];
              console.log('Using profile:', bestProfileKey, 'Available:', availableProfiles);

              // Map item types to build slot names
              const itemTypeToSlot: Record<string, string> = {
                'offhand': 'weapon',
                'shield': 'weapon',
                'focus': 'weapon',
                'totem': 'weapon',
              };
              let slotType = itemTypeToSlot[comparison.newItem.type] || comparison.newItem.type;
              let slotRequirements = profile.gear[slotType];

              // If slot not found, or item is a unique, search all slots for matching unique
              // This handles cases where Maxroll's data has shields in unexpected slots
              if (!slotRequirements || comparison.newItem.is_unique || comparison.equippedItem.is_unique) {
                const uniqueNames = [
                  comparison.newItem.unique_id,
                  comparison.equippedItem.unique_id,
                  comparison.newItem.name,
                  comparison.equippedItem.name,
                ].filter(Boolean).map(n => n?.toLowerCase().replace(/_/g, ' '));

                console.log('Searching for uniques:', uniqueNames);

                for (const [slot, reqs] of Object.entries(profile.gear)) {
                  const slotUniques = (reqs.priority_uniques || []).map((u: string) => u.toLowerCase());
                  if (slotUniques.length > 0) {
                    console.log(`Slot ${slot} has uniques:`, slotUniques);
                  }
                  // Check if any unique name matches any slot unique
                  const matched = uniqueNames.some(name =>
                    slotUniques.some(u => {
                      const matches = name?.includes(u) || u.includes(name || '');
                      if (matches) console.log(`MATCH: "${name}" matches "${u}" in slot ${slot}`);
                      return matches;
                    })
                  );
                  if (matched) {
                    slotType = slot;
                    slotRequirements = reqs;
                    console.log('Found matching slot:', slot);
                    break;
                  }
                }
              }

              if (!slotRequirements) {
                // Last resort: use generic weapon slot or first available
                slotRequirements = profile.gear['weapon'] || Object.values(profile.gear)[0];
                slotType = 'weapon';
              }

              if (!slotRequirements) {
                throw new Error(`No requirements found for slot: ${slotType} (item type: ${comparison.newItem.type})`);
              }

              // Score both items against the build
              const newItemScore = scoreItemForSlot(comparison.newItem, slotRequirements);
              const equippedScore = scoreItemForSlot(comparison.equippedItem, slotRequirements);

              // Generate recommendation and reasons
              const reasons: string[] = [];
              let recommendation: 'equip' | 'keep';

              if (newItemScore.score > equippedScore.score) {
                recommendation = 'equip';
                if (newItemScore.hasPriorityUnique && !equippedScore.hasPriorityUnique) {
                  reasons.push(`New item has a priority unique for this build`);
                }
                if (newItemScore.matchingAffixes > equippedScore.matchingAffixes) {
                  reasons.push(`Better affixes: ${newItemScore.matchingAffixes}/${newItemScore.totalPriorityAffixes} vs ${equippedScore.matchingAffixes}/${equippedScore.totalPriorityAffixes}`);
                }
                if (comparison.newItem.item_power > comparison.equippedItem.item_power) {
                  reasons.push(`Higher item power: ${comparison.newItem.item_power} vs ${comparison.equippedItem.item_power}`);
                }
                reasons.push(`Build score: ${newItemScore.score.toFixed(0)} vs ${equippedScore.score.toFixed(0)}`);
              } else if (equippedScore.score > newItemScore.score) {
                recommendation = 'keep';
                if (equippedScore.hasPriorityUnique && !newItemScore.hasPriorityUnique) {
                  reasons.push(`Current item has a priority unique for this build`);
                }
                if (equippedScore.matchingAffixes > newItemScore.matchingAffixes) {
                  reasons.push(`Better affixes: ${equippedScore.matchingAffixes}/${equippedScore.totalPriorityAffixes} vs ${newItemScore.matchingAffixes}/${newItemScore.totalPriorityAffixes}`);
                }
                reasons.push(`Build score: ${equippedScore.score.toFixed(0)} vs ${newItemScore.score.toFixed(0)}`);
              } else {
                // Tie - default to keep unless new item has higher IP
                recommendation = comparison.newItem.item_power > comparison.equippedItem.item_power ? 'equip' : 'keep';
                reasons.push(`Items are roughly equal for this build`);
                if (comparison.newItem.item_power !== comparison.equippedItem.item_power) {
                  reasons.push(`Item power: ${comparison.newItem.item_power} vs ${comparison.equippedItem.item_power}`);
                }
              }

              setComparisonAnalysis({
                comparison,
                newItemScore,
                equippedScore,
                recommendation,
                reasons,
                profileUsed: bestProfileKey,
              });
              setAppState('compare-result');
            } else {
              // Normal item scan
              const item = await parseItem(imageBase64, playerClass!);
              setGear((prev) => ({
                ...prev,
                [item.type]: [...(prev[item.type] || []), item],
              }));
            }
          }}
          onComplete={() => setAppState(scanMode === 'compare' ? 'compare-result' : 'inventory')}
          onCancel={() => setAppState('inventory')}
        />
      )}

      {/* Results View */}
      {appState === 'results' && (
        <div className="p-4">
          <div className="max-w-md mx-auto mb-4">
            <button
              onClick={() => setAppState('inventory')}
              className="text-sm text-gray-400 hover:text-white"
            >
              ← Back to Inventory
            </button>
          </div>

          <div className="text-center mb-6">
            <h2 className="text-lg font-semibold mb-2">Build Matches</h2>
            <p className="text-sm text-gray-400">Based on your {gearCount} scanned item{gearCount !== 1 ? 's' : ''}</p>
          </div>

          <div className="max-w-md mx-auto space-y-4">
            {buildMatches && buildMatches.length > 0 ? (
              buildMatches.map((match) => {
                const bestProfileMatch = match.profileMatches.find(p => p.profileName === match.bestProfile);

                return (
                  <div key={match.buildId} className="bg-gray-800 rounded-lg p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="font-semibold text-white">{match.buildName}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          match.tier === 'S' ? 'bg-fuchsia-600' :
                          match.tier === 'A' ? 'bg-orange-500' :
                          match.tier === 'B' ? 'bg-yellow-500 text-black' :
                          match.tier === 'C' ? 'bg-blue-500' : 'bg-gray-600'
                        }`}>
                          {match.tier} Tier
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-red-400">{match.bestPercentage}%</div>
                        <div className="text-xs text-gray-500">best match</div>
                      </div>
                    </div>

                    {/* Profile breakdown */}
                    <div className="flex gap-2 mb-3 flex-wrap">
                      {match.profileMatches.map((pm) => {
                        const isSelected = pm.profileName === match.bestProfile;
                        const profileColors: Record<string, string> = {
                          starter: 'bg-yellow-700',
                          ancestral: 'bg-blue-700',
                          mythic: 'bg-purple-700',
                          sanctification: 'bg-fuchsia-700',
                        };
                        const bgColor = profileColors[pm.profileName] || 'bg-gray-600';

                        return (
                          <div
                            key={pm.profileName}
                            className={`text-xs px-2 py-1 rounded ${bgColor} ${isSelected ? 'ring-2 ring-white' : 'opacity-60'}`}
                            title={`${pm.profileDisplayName}: ${pm.percentage}%`}
                          >
                            {pm.profileDisplayName}: {pm.percentage}%
                          </div>
                        );
                      })}
                    </div>

                    {/* Progress bar */}
                    <div className="w-full bg-gray-700 rounded-full h-2 mb-3">
                      <div
                        className="bg-red-500 h-2 rounded-full transition-all"
                        style={{ width: `${match.bestPercentage}%` }}
                      />
                    </div>

                    {/* Missing critical items from best profile */}
                    {bestProfileMatch && bestProfileMatch.missingCritical.length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs text-gray-500 mb-1">Missing key items ({bestProfileMatch.profileDisplayName}):</p>
                        <div className="flex flex-wrap gap-1">
                          {bestProfileMatch.missingCritical.slice(0, 3).map((item, i) => (
                            <span key={i} className="text-xs bg-red-900/50 text-red-300 px-2 py-0.5 rounded">
                              {item.item.replace(/_/g, ' ')}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Slot breakdown */}
                    {bestProfileMatch && (
                      <details className="text-sm">
                        <summary className="text-gray-400 cursor-pointer hover:text-gray-300">
                          View slot details ({bestProfileMatch.profileDisplayName})
                        </summary>
                        <div className="mt-2 space-y-2">
                          {Object.entries(bestProfileMatch.recommendedLoadout).map(([slot, info]) => {
                            // Tier-based styling
                            const tierStyles = {
                              bis: { bg: 'bg-green-900/40', text: 'text-green-400', border: 'border-green-500/30' },
                              ancestral: { bg: 'bg-blue-900/30', text: 'text-blue-400', border: 'border-blue-500/30' },
                              starter: { bg: 'bg-yellow-900/30', text: 'text-yellow-400', border: 'border-yellow-500/30' },
                              not_recommended: { bg: 'bg-red-900/30', text: 'text-red-400', border: 'border-red-500/30' },
                              none: { bg: 'bg-gray-800', text: 'text-gray-500', border: 'border-gray-700' },
                            };
                            const style = tierStyles[info.tier] || tierStyles.none;
                            const slotPct = info.maxScore > 0 ? Math.round((info.score / info.maxScore) * 100) : 0;

                            return (
                              <div key={slot} className={`${style.bg} ${style.border} border rounded p-2`}>
                                <div className="flex justify-between items-center">
                                  <span className="text-gray-400 capitalize text-xs">{slot}</span>
                                  {info.item && info.tier !== 'not_recommended' && (
                                    <span className={`${style.text} font-medium text-xs`}>
                                      {slotPct}%
                                    </span>
                                  )}
                                </div>
                                {info.item ? (
                                  <>
                                    <div className="text-gray-200 font-medium truncate">
                                      {info.item.name}
                                    </div>
                                    <div className={`text-xs ${style.text}`}>{info.notes}</div>
                                  </>
                                ) : (
                                  <div className="text-gray-600 italic">No item scanned</div>
                                )}
                                {info.tier !== 'none' && (info.tier === 'not_recommended' || info.tier === 'starter') &&
                                  bestProfileMatch.upgradePriorities.find(u => u.slot === slot) && (
                                  <div className="text-xs text-yellow-500 mt-1">
                                    ↑ {bestProfileMatch.upgradePriorities.find(u => u.slot === slot)?.suggestion}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    )}

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
                );
              })
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

      {/* Comparison Result View */}
      {appState === 'compare-result' && comparisonAnalysis && (
        <div className="p-4">
          <div className="max-w-md mx-auto mb-4">
            <button
              onClick={() => setAppState('inventory')}
              className="text-sm text-gray-400 hover:text-white"
            >
              ← Back to Inventory
            </button>
          </div>

          <div className="text-center mb-6">
            <h2 className="text-lg font-semibold mb-2">Item Comparison</h2>
            <p className="text-sm text-gray-400">
              For <span className="text-red-400">{selectedBuild?.name}</span>
            </p>
            <p className="text-xs text-gray-500">
              Using {comparisonAnalysis.profileUsed} profile
            </p>
          </div>

          <div className="max-w-md mx-auto">
            {/* Recommendation Banner */}
            <div className={`rounded-lg p-6 mb-4 text-center ${
              comparisonAnalysis.recommendation === 'equip'
                ? 'bg-green-900/50 border border-green-500/50'
                : 'bg-blue-900/50 border border-blue-500/50'
            }`}>
              <div className="text-4xl mb-2">
                {comparisonAnalysis.recommendation === 'equip' ? '⬆️' : '✓'}
              </div>
              <h3 className={`text-2xl font-bold mb-2 ${
                comparisonAnalysis.recommendation === 'equip' ? 'text-green-400' : 'text-blue-400'
              }`}>
                {comparisonAnalysis.recommendation === 'equip' ? 'Equip New Item' : 'Keep Current'}
              </h3>
              <ul className="text-sm text-gray-300 space-y-1">
                {comparisonAnalysis.reasons.map((reason, i) => (
                  <li key={i}>{reason}</li>
                ))}
              </ul>
            </div>

            {/* Side by Side Comparison */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              {/* New Item */}
              <div className={`rounded-lg p-3 ${
                comparisonAnalysis.recommendation === 'equip'
                  ? 'bg-green-900/30 border border-green-500/30'
                  : 'bg-gray-800 border border-gray-700'
              }`}>
                <div className="text-xs text-gray-500 mb-1">NEW ITEM</div>
                <div className="font-medium text-sm truncate">
                  {comparisonAnalysis.comparison.newItem.name}
                </div>
                <div className="text-xs text-gray-400">
                  {comparisonAnalysis.comparison.newItem.item_power} IP
                </div>
                <div className="mt-2 text-xs">
                  <div className={comparisonAnalysis.newItemScore.hasPriorityUnique ? 'text-green-400' : 'text-gray-500'}>
                    {comparisonAnalysis.newItemScore.hasPriorityUnique ? '✓ Priority Unique' : '○ Not priority unique'}
                  </div>
                  <div className="text-gray-400">
                    {comparisonAnalysis.newItemScore.matchingAffixes}/{comparisonAnalysis.newItemScore.totalPriorityAffixes} affixes
                  </div>
                  <div className="text-gray-400 font-medium">
                    Score: {comparisonAnalysis.newItemScore.score.toFixed(0)}
                  </div>
                </div>
              </div>

              {/* Equipped Item */}
              <div className={`rounded-lg p-3 ${
                comparisonAnalysis.recommendation === 'keep'
                  ? 'bg-blue-900/30 border border-blue-500/30'
                  : 'bg-gray-800 border border-gray-700'
              }`}>
                <div className="text-xs text-gray-500 mb-1">EQUIPPED</div>
                <div className="font-medium text-sm truncate">
                  {comparisonAnalysis.comparison.equippedItem.name}
                </div>
                <div className="text-xs text-gray-400">
                  {comparisonAnalysis.comparison.equippedItem.item_power} IP
                </div>
                <div className="mt-2 text-xs">
                  <div className={comparisonAnalysis.equippedScore.hasPriorityUnique ? 'text-green-400' : 'text-gray-500'}>
                    {comparisonAnalysis.equippedScore.hasPriorityUnique ? '✓ Priority Unique' : '○ Not priority unique'}
                  </div>
                  <div className="text-gray-400">
                    {comparisonAnalysis.equippedScore.matchingAffixes}/{comparisonAnalysis.equippedScore.totalPriorityAffixes} affixes
                  </div>
                  <div className="text-gray-400 font-medium">
                    Score: {comparisonAnalysis.equippedScore.score.toFixed(0)}
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-3">
              <button
                onClick={() => {
                  setScanMode('compare');
                  setAppState('camera');
                }}
                className="w-full py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium"
              >
                Compare Another Item
              </button>
              <button
                onClick={() => setAppState('inventory')}
                className="w-full py-3 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium"
              >
                Back to Inventory
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
