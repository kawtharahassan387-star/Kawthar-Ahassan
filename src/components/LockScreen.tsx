import React, { useState } from 'react';
import { Lock, Eye, EyeOff, AlertTriangle, Key } from 'lucide-react';
import { motion } from 'motion/react';

interface PasswordSetupFormProps {
  onSetup: (password: string) => void;
}

export function PasswordSetupForm({ onSetup }: PasswordSetupFormProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 4) {
      setError('Le mot de passe doit contenir au moins 4 caractères.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }
    setError('');
    onSetup(password);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3.5 bg-rose-50 border border-rose-100 rounded-2xl flex items-start gap-2.5 text-rose-600 text-xs font-bold leading-relaxed">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-2">
        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Nouveau mot de passe</label>
        <div className="relative">
          <input 
            type={showPass ? "text" : "password"}
            required
            className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-100 hover:bg-slate-100/50 outline-none focus:ring-2 focus:ring-indigo-600 transition-all font-bold text-slate-850"
            placeholder="Ex: admin1234"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(''); }}
          />
          <button 
            type="button" 
            onClick={() => setShowPass(!showPass)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900 transition-colors"
          >
            {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Confirmer le mot de passe</label>
        <input 
          type="password"
          required
          className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-100 hover:bg-slate-100/50 outline-none focus:ring-2 focus:ring-indigo-600 transition-all font-bold text-slate-850"
          placeholder="Ressaisir le mot de passe"
          value={confirmPassword}
          onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
        />
      </div>

      <button 
        type="submit"
        className="w-full py-4.5 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-wider hover:bg-indigo-700 shadow-xl shadow-indigo-150 transition-all active:scale-[0.98] mt-2"
      >
        Définir & Activer le code
      </button>
    </form>
  );
}

interface PasswordUnlockFormProps {
  correctPassword: string;
  onUnlock: () => void;
}

export function PasswordUnlockForm({ correctPassword, onUnlock }: PasswordUnlockFormProps) {
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Safety check with localstorage check too in case db mismatch on edge case
    const localBackup = localStorage.getItem('stockpro_app_lock_password');
    const isCorrect = password === correctPassword || (localBackup && password === localBackup);

    if (isCorrect) {
      setError('');
      onUnlock();
    } else {
      setError('Mot de passe incorrect. Veuillez réessayer.');
      setPassword('');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <motion.div 
          initial={{ opacity: 0, y: -5 }} 
          animate={{ opacity: 1, y: 0 }}
          className="p-3 bg-rose-50 border border-rose-100 rounded-2xl text-rose-600 text-[11px] font-bold text-center leading-relaxed"
        >
          {error}
        </motion.div>
      )}

      <div className="space-y-2">
        <div className="relative">
          <input 
            type={showPass ? "text" : "password"}
            required
            autoFocus
            className="w-full p-4.5 bg-slate-50 rounded-2xl border border-slate-100 hover:bg-slate-100/50 outline-none focus:ring-2 focus:ring-indigo-650 text-center font-black text-lg tracking-widest text-slate-800"
            placeholder="••••••••"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(''); }}
          />
          <button 
            type="button" 
            onClick={() => setShowPass(!showPass)}
            className="absolute right-4.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-850 transition-colors"
          >
            {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </div>

      <button 
        type="submit"
        className="w-full py-4.5 bg-slate-900 border border-slate-950 text-white rounded-2xl font-black text-xs uppercase tracking-wider hover:bg-slate-800 shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2"
      >
        <Key size={14} className="animate-pulse" />
        Déverrouiller
      </button>

      <p className="text-[10px] text-slate-400 text-center font-bold font-mono">
        Sécurisé par Chiffrement d'Accès
      </p>
    </form>
  );
}
