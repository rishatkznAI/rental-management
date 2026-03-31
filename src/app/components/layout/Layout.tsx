import React from 'react';
import { Outlet } from 'react-router';
import { Sidebar } from './Sidebar';

export function Layout() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <main className="ml-64 min-h-screen">
        <Outlet />
      </main>
    </div>
  );
}