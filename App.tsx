
import React, { useState, useCallback } from 'react';
import Viewer from './components/Viewer';

const App: React.FC = () => {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && (file.name.endsWith('.glb') || file.name.endsWith('.gltf'))) {
      setUploadedFile(file);
    } else {
      alert("Please upload a valid .glb or .gltf file");
    }
  }, []);

  return (
    <div className="relative w-screen h-screen bg-black text-white overflow-hidden font-sans">
      {/* Background 3D Viewer */}
      <Viewer file={uploadedFile} />

      {/* Overlay UI */}
      <div className="absolute top-0 left-0 p-6 pointer-events-none w-full flex justify-between items-start">
        <div className="pointer-events-auto bg-black/60 backdrop-blur-md p-6 rounded-xl border border-white/10 shadow-2xl">
          <h1 className="text-3xl font-black tracking-tighter uppercase mb-2 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            Shatter Studio
          </h1>
          <p className="text-sm text-gray-400 mb-6 max-w-xs">
            Upload a 3D model (.glb/.gltf) and witness its dynamic fragmentation using proximity-based geometry partitioning.
          </p>
          
          <div className="flex flex-col gap-4">
            <label className="flex items-center justify-center px-4 py-3 bg-white text-black font-bold rounded-lg cursor-pointer hover:bg-gray-200 transition-colors shadow-lg active:scale-95">
              <span className="mr-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </span>
              UPLOAD ASSET
              <input 
                type="file" 
                className="hidden" 
                accept=".glb,.gltf"
                onChange={handleFileChange}
              />
            </label>
            
            {!uploadedFile && (
              <p className="text-xs text-center text-blue-400 animate-pulse font-medium">
                Wait for upload to begin...
              </p>
            )}
            
            {uploadedFile && (
              <div className="text-xs bg-white/5 p-3 rounded-md border border-white/5">
                <span className="text-gray-500 block">Loaded Model:</span>
                <span className="font-mono text-green-400 truncate block">{uploadedFile.name}</span>
              </div>
            )}
          </div>
        </div>

        {/* Legend / Instructions */}
        <div className="pointer-events-auto bg-black/40 backdrop-blur-sm p-4 rounded-lg border border-white/5 text-[10px] text-gray-500 hidden md:block">
          <p>LMB: Rotate Scene</p>
          <p>RMB: Pan Camera</p>
          <p>Scroll: Zoom</p>
          <p className="mt-2 text-white/40">Use GUI on the right to trigger shatter effect</p>
        </div>
      </div>

      {/* Footer Branding */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-none opacity-20 hover:opacity-100 transition-opacity">
        <span className="text-xs tracking-[0.3em] font-light">CORE3D • GEOMETRY SHATTER ENGINE</span>
      </div>
    </div>
  );
};

export default App;
