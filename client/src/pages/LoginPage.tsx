/**
 * Staff login — styled as a game "level select" screen.
 * The 3D scene is pure CSS (see login.css); the form logic is plain
 * react-hook-form + zod, same as before.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, Gamepad2, Loader2, Lock, Mail } from 'lucide-react';
import { Suspense, lazy, useCallback, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { z } from 'zod';
import { errorMessage } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import './login.css';

const schema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});
type FormValues = z.infer<typeof schema>;

// ----------------------------------------------------------------- 3D PlayStation symbols

type Symbol = 'triangle' | 'circle' | 'cross' | 'square';

/** Official symbol colours. */
const SYMBOL_COLOR: Record<Symbol, string> = {
  triangle: '#34d399',
  circle: '#f87171',
  cross: '#60a5fa',
  square: '#f472b6',
};

function SymbolPath({ kind, color, opacity }: { kind: Symbol; color: string; opacity: number }) {
  const common = { fill: 'none', stroke: color, strokeWidth: 9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, opacity };
  return (
    <svg viewBox="0 0 100 100" aria-hidden>
      {kind === 'triangle' && <path d="M50 14 L88 80 L12 80 Z" {...common} />}
      {kind === 'circle' && <circle cx="50" cy="50" r="34" {...common} />}
      {kind === 'cross' && <path d="M20 20 L80 80 M80 20 L20 80" {...common} />}
      {kind === 'square' && <rect x="18" y="18" width="64" height="64" rx="4" {...common} />}
    </svg>
  );
}

/** One symbol, extruded: the same outline stacked back in Z reads as a solid 3D shape. */
function Shape3D({ kind, style }: { kind: Symbol; style: CSSProperties }) {
  const color = SYMBOL_COLOR[kind];
  const depth = 7;
  return (
    <div className="lv-shape" style={{ ...style, ['--glow' as string]: color }}>
      {Array.from({ length: depth }, (_, i) => (
        <div key={i} style={{ position: 'absolute', inset: 0, transform: `translateZ(${-i * 2.5}px)` }}>
          <SymbolPath kind={kind} color={color} opacity={i === 0 ? 1 : 0.55 - i * 0.06} />
        </div>
      ))}
    </div>
  );
}

const SHAPES: Array<{ kind: Symbol; style: CSSProperties }> = [
  { kind: 'triangle', style: { top: '12%', left: '9%', ['--size' as string]: '84px', ['--spin' as string]: '16s', ['--float' as string]: '7s' } },
  { kind: 'circle', style: { top: '18%', right: '10%', ['--size' as string]: '72px', ['--spin' as string]: '12s', ['--delay' as string]: '-3s' } },
  { kind: 'cross', style: { bottom: '22%', left: '14%', ['--size' as string]: '60px', ['--spin' as string]: '10s', ['--delay' as string]: '-5s' } },
  { kind: 'square', style: { bottom: '28%', right: '15%', ['--size' as string]: '68px', ['--spin' as string]: '18s', ['--delay' as string]: '-2s' } },
  { kind: 'cross', style: { top: '6%', left: '46%', ['--size' as string]: '34px', ['--spin' as string]: '9s', ['--delay' as string]: '-1s' } },
  { kind: 'circle', style: { bottom: '8%', left: '42%', ['--size' as string]: '40px', ['--spin' as string]: '11s', ['--delay' as string]: '-6s' } },
];

// ----------------------------------------------------------------- 3D controller

// three.js is only downloaded after the form is on screen.
const Controller3D = lazy(() => import('../components/Controller3D'));

/** Shown while the 3D controller loads, or if the PC can't run WebGL. */
function LogoFallback() {
  return (
    <div className="grid h-full place-items-center" style={{ perspective: 600 }}>
      <div className="lv-logo grid size-24 place-items-center rounded-3xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-[0_0_50px_rgba(168,85,247,0.6)]">
        <Gamepad2 className="size-12" aria-hidden />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- page

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const cardRef = useRef<HTMLDivElement>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const onWebglError = useCallback(() => setWebglFailed(true), []);
  const { register, handleSubmit, formState } = useForm<FormValues>({ resolver: zodResolver(schema) });

  if (user) return <Navigate to="/" replace />;

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setError(null);
    try {
      await login(email, password);
      navigate((location.state as { from?: string } | null)?.from ?? '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Login failed'));
    }
  });

  // Card tilts towards the mouse (max ~8°).
  const onMove = (e: MouseEvent) => {
    const r = cardRef.current?.getBoundingClientRect();
    if (!r) return;
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    setTilt({ x: -py * 8, y: px * 8 });
  };

  const { errors } = formState;

  return (
    <div className="lv-scene flex min-h-full items-center justify-center px-4 py-12">
      {/* Background level */}
      <div className="lv-stars" aria-hidden />
      <div className="lv-sun" aria-hidden />
      <div className="lv-floor" aria-hidden />
      <div className="hidden sm:block" aria-hidden>
        {SHAPES.map((s, i) => (
          <Shape3D key={i} kind={s.kind} style={s.style} />
        ))}
      </div>

      {/* Foreground: 3D controller + title (left on desktop, top on mobile), login card */}
      <div className="relative z-10 grid w-full max-w-5xl items-center gap-4 lg:grid-cols-2 lg:gap-10">
        <div className="flex flex-col items-center text-center">
          <div className="relative h-48 w-full max-w-md sm:h-64 lg:h-[380px]">
            {/* soft neon glow under the controller */}
            <div className="absolute inset-x-10 bottom-4 top-10 rounded-full bg-violet-600/30 blur-3xl" aria-hidden />
            {webglFailed ? (
              <LogoFallback />
            ) : (
              <Suspense fallback={<LogoFallback />}>
                <Controller3D onError={onWebglError} spin={formState.isSubmitting} />
              </Suspense>
            )}
          </div>
          <h1 className="lv-title text-3xl font-extrabold tracking-wide drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)] lg:text-4xl">GAME CENTER</h1>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.35em] text-slate-300 [text-shadow:0_1px_8px_rgba(0,0,0,0.95)]">
            Player 1 · Staff login<span className="lv-blink">_</span>
          </p>
        </div>

        <div className="mx-auto w-full max-w-sm">

        <div className="lv-card-wrap" onMouseMove={onMove} onMouseLeave={() => setTilt({ x: 0, y: 0 })}>
          <div ref={cardRef} className="lv-card" style={{ transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}>
            <div className="lv-border" aria-hidden />
            <form onSubmit={onSubmit} className="lv-glass space-y-5 p-7" noValidate>
              {error && (
                <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="email" className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Email
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-violet-300" aria-hidden />
                  <input
                    id="email"
                    type="email"
                    autoComplete="username"
                    autoFocus
                    placeholder="you@gamecenter.local"
                    className="lv-input"
                    aria-invalid={!!errors.email}
                    {...register('email')}
                  />
                </div>
                {errors.email && <p className="text-xs text-red-300">{errors.email.message}</p>}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="password" className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Password
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-violet-300" aria-hidden />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="lv-input"
                    aria-invalid={!!errors.password}
                    {...register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:text-white"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {errors.password && <p className="text-xs text-red-300">{errors.password.message}</p>}
              </div>

              <button
                type="submit"
                disabled={formState.isSubmitting}
                className="lv-start flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold text-white disabled:opacity-70"
                aria-label="Press start — sign in"
              >
                {formState.isSubmitting ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
                {formState.isSubmitting ? 'LOADING…' : '▶ PRESS START'}
              </button>
            </form>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-300 [text-shadow:0_1px_8px_rgba(0,0,0,0.9)]">PS5 · PS4 · Session &amp; billing control</p>
        </div>
      </div>
    </div>
  );
}
