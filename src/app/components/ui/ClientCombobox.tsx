import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import type { Client } from '../../types';
import { cn } from './utils';

function clientLabel(client: Client): string {
  return client.company;
}

function clientSubtitle(client: Client): string {
  return [client.contact, client.phone, client.inn].filter(Boolean).join(' · ');
}

function matchesSearch(client: Client, query: string): boolean {
  if (!query.trim()) return true;
  const lower = query.trim().toLowerCase();
  return (
    client.company.toLowerCase().includes(lower) ||
    client.contact.toLowerCase().includes(lower) ||
    client.phone.toLowerCase().includes(lower) ||
    client.inn.toLowerCase().includes(lower) ||
    client.email.toLowerCase().includes(lower)
  );
}

export interface ClientComboboxProps {
  clients: Client[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  initialLimit?: number;
}

export function ClientCombobox({
  clients,
  value,
  onChange,
  placeholder = 'Введите название, ИНН, контакт или телефон…',
  className,
  initialLimit = 10,
}: ClientComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedClient = useMemo(
    () => clients.find(client => client.company === value) ?? null,
    [clients, value],
  );

  const filteredClients = useMemo(() => {
    const base = query.trim() ? clients.filter(client => matchesSearch(client, query)) : clients.slice(0, initialLimit);
    return [...base].sort((left, right) => left.company.localeCompare(right.company, 'ru'));
  }, [clients, query, initialLimit]);

  const handleSelect = useCallback((client: Client) => {
    onChange(client.company);
    setOpen(false);
    setQuery('');
    setHighlighted(-1);
  }, [onChange]);

  const handleClear = (event: React.MouseEvent) => {
    event.stopPropagation();
    onChange('');
    setQuery('');
    setHighlighted(-1);
  };

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
        setHighlighted(-1);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      setOpen(true);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted(current => Math.min(current + 1, filteredClients.length - 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted(current => Math.max(current - 1, 0));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (highlighted >= 0 && filteredClients[highlighted]) {
        handleSelect(filteredClients[highlighted]);
      }
      return;
    }

    if (event.key === 'Escape') {
      setOpen(false);
      setQuery('');
      setHighlighted(-1);
    }
  };

  useEffect(() => {
    if (highlighted < 0 || !dropdownRef.current) return;
    const items = dropdownRef.current.querySelectorAll<HTMLLIElement>('[data-client-item]');
    items[highlighted]?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  useEffect(() => {
    setHighlighted(-1);
  }, [query]);

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      <div
        className={cn(
          'flex h-10 w-full cursor-text items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-sm',
          'dark:border-gray-600 dark:bg-gray-700',
          open
            ? 'border-[--color-primary] ring-1 ring-[--color-primary]'
            : 'hover:border-gray-400 dark:hover:border-gray-500',
        )}
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-gray-400" />

        {open ? (
          <input
            ref={inputRef}
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-gray-900 outline-none placeholder:text-gray-400 dark:text-white"
            placeholder={selectedClient ? clientLabel(selectedClient) : placeholder}
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        ) : (
          <span className={cn('min-w-0 flex-1 truncate', !selectedClient && 'text-gray-400')}>
            {selectedClient ? clientLabel(selectedClient) : placeholder}
          </span>
        )}

        {value ? (
          <button
            type="button"
            onMouseDown={handleClear}
            className="shrink-0 rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            tabIndex={-1}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        )}
      </div>

      {open && (
        <div
          ref={dropdownRef}
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800"
        >
          {filteredClients.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-gray-400">
              {query.trim() ? 'Клиент не найден' : 'Нет клиентов в базе'}
            </p>
          ) : (
            <ul>
              {filteredClients.map((clientItem, index) => {
                const isHighlighted = highlighted === index;
                const isSelected = clientItem.company === value;
                return (
                  <li
                    key={clientItem.id}
                    data-client-item
                    onMouseDown={() => handleSelect(clientItem)}
                    onMouseEnter={() => setHighlighted(index)}
                    className={cn(
                      'flex cursor-pointer select-none items-start gap-2 px-3 py-2 text-sm transition-colors',
                      isHighlighted
                        ? 'bg-[--color-primary]/10 text-[--color-primary]'
                        : 'text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700/60',
                    )}
                  >
                    <span className="w-4 shrink-0 text-[--color-primary]">{isSelected ? '✓' : ''}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{clientLabel(clientItem)}</p>
                      <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                        {clientSubtitle(clientItem) || clientItem.email}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
