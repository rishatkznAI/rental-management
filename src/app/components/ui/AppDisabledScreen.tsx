import { ShieldAlert } from 'lucide-react';

interface AppDisabledScreenProps {
  message?: string;
}

export function AppDisabledScreen({ message }: AppDisabledScreenProps) {
  return (
    <main className="flex min-h-screen w-screen items-center justify-center bg-[#0e0e0e] px-6 text-[#f0f0f0]">
      <section className="w-full max-w-[520px] text-center">
        <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-lg bg-[#c8f135] text-[#0b1120]">
          <ShieldAlert className="h-6 w-6" aria-hidden="true" strokeWidth={2.2} />
        </div>
        <h1 className="text-[26px] font-semibold leading-8 tracking-normal">Система временно отключена</h1>
        <p className="mt-3 text-[15px] leading-6 text-[#b5b5b5]">Работа приложения приостановлена администратором</p>
        {message && (
          <p className="mx-auto mt-6 max-w-[420px] rounded-lg border border-[#252525] bg-[#141414] px-4 py-3 text-[13px] leading-5 text-[#d8d8d8]">
            {message}
          </p>
        )}
      </section>
    </main>
  );
}
