import React, { useEffect, useState } from "react";

const AnimatedBackground = () => {
  const [particles, setParticles] = useState<
    Array<{ id: number; left: number; top: number; size: number; delay: number; duration: number }>
  >([]);

  useEffect(() => {
    // Generate random particles that will float around the center column
    const newParticles = Array.from({ length: 40 }).map((_, i) => ({
      id: i,
      left: 40 + Math.random() * 20, // Concentrated in the middle 40% - 60%
      top: 50 + Math.random() * 50, // Starting in the lower half
      size: 2 + Math.random() * 4,
      delay: Math.random() * 3,
      duration: 3 + Math.random() * 4,
    }));
    setParticles(newParticles);
  }, []);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden bg-slate-50 pointer-events-none">
      {/* The base static design you liked */}
      <div className="absolute inset-0 bg-[url('/hero-background.png')] bg-center bg-no-repeat bg-cover" />

      {/* Subtle pulsing glow overlay over the fountain */}
      <div className="absolute inset-0 bg-[url('/hero-background.png')] bg-center bg-no-repeat bg-cover opacity-50 mix-blend-color-dodge animate-pulse-slow" />

      {/* Floating particles mimicking data flow */}
      <div className="absolute inset-0 z-10">
        {particles.map((p) => (
          <div
            key={p.id}
            className="absolute rounded-full bg-blue-400/80 blur-[0.5px]"
            style={{
              left: `${p.left}%`,
              top: `${p.top}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              animation: `floatUp ${p.duration}s infinite linear`,
              animationDelay: `${p.delay}s`,
            }}
          />
        ))}
      </div>

      <style>{`
        @keyframes floatUp {
          0% {
            transform: translateY(0) scale(1);
            opacity: 0;
          }
          20% {
            opacity: 0.8;
          }
          80% {
            opacity: 0.6;
          }
          100% {
            transform: translateY(-300px) scale(0.5);
            opacity: 0;
          }
        }
        
        .animate-pulse-slow {
          animation: pulseSlow 4s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }

        @keyframes pulseSlow {
          0%, 100% {
            opacity: 0.1;
          }
          50% {
            opacity: 0.6;
          }
        }
      `}</style>
    </div>
  );
};

export default AnimatedBackground;
