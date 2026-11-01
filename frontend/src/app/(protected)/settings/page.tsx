"use client";

import { useAuth } from "@/features/auth/AuthContext";
import { motion } from "framer-motion";
import { User, Mail, Shield, LogOut } from "lucide-react";

export default function SettingsPage() {
  const { user, logout } = useAuth();

  return (
    <div className="h-full overflow-y-auto bg-surface-950 p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-xl font-semibold text-white mb-6">Settings</h1>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl bg-surface-900 border border-surface-800 overflow-hidden mb-4"
        >
          <div className="px-5 py-4 border-b border-surface-800">
            <h2 className="text-sm font-medium text-surface-200">Account</h2>
          </div>
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-brand-600/30 border border-brand-500/40 flex items-center justify-center text-brand-400">
                <User className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">{user?.full_name}</p>
                <p className="text-xs text-surface-400">{user?.email}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-800/60">
              <Shield className="w-4 h-4 text-surface-400" />
              <span className="text-sm text-surface-300">
                {user?.is_platform_admin ? "Platform Administrator" : "Organization Member"}
              </span>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-800/60">
              <Mail className="w-4 h-4 text-surface-400" />
              <span className="text-sm text-surface-300">Account status: {user?.status}</span>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-xl bg-surface-900 border border-surface-800 overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-surface-800">
            <h2 className="text-sm font-medium text-surface-200">Session</h2>
          </div>
          <div className="p-5">
            <button
              onClick={() => logout()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-red-500/40"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
