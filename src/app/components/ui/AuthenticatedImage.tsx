import React from 'react';
import { ImageOff } from 'lucide-react';
import { getToken } from '../../lib/api';
import { cn } from '../../lib/utils';
import { isAuthenticatedMediaUrl, type NormalizedPhoto } from '../../lib/media';

function statusReason(status: number) {
  if (status === 401 || status === 403) return 'Нет доступа';
  if (status === 404) return 'Файл не найден';
  if (status >= 500) return 'Ошибка загрузки файла';
  return 'Фото недоступно';
}

type AuthenticatedImageProps = {
  photo: NormalizedPhoto;
  alt: string;
  className?: string;
  fallbackClassName?: string;
  imgClassName?: string;
  onOpen?: (url: string) => void;
};

export function AuthenticatedImage({
  photo,
  alt,
  className,
  fallbackClassName,
  imgClassName,
  onOpen,
}: AuthenticatedImageProps) {
  const [objectUrl, setObjectUrl] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState(photo.unavailableReason || '');
  const [failed, setFailed] = React.useState(Boolean(photo.isBroken || !photo.thumbnailUrl));
  const thumbnailUrl = photo.thumbnailUrl || photo.url;
  const needsAuth = Boolean(thumbnailUrl && isAuthenticatedMediaUrl(thumbnailUrl));

  React.useEffect(() => {
    setObjectUrl(null);
    setReason(photo.unavailableReason || '');
    setFailed(Boolean(photo.isBroken || !thumbnailUrl));

    if (!thumbnailUrl || photo.isBroken || !needsAuth) return undefined;

    const controller = new AbortController();
    let nextObjectUrl: string | null = null;

    const load = async () => {
      try {
        const token = getToken();
        const response = await fetch(thumbnailUrl, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          credentials: 'include',
          signal: controller.signal,
        });
        if (!response.ok) {
          setReason(statusReason(response.status));
          setFailed(true);
          return;
        }
        const contentType = response.headers.get('content-type') || '';
        if (contentType && !contentType.toLowerCase().startsWith('image/')) {
          setReason('Ответ не является изображением');
          setFailed(true);
          return;
        }
        const blob = await response.blob();
        if (!blob.size) {
          setReason('Файл пустой');
          setFailed(true);
          return;
        }
        nextObjectUrl = URL.createObjectURL(blob);
        setObjectUrl(nextObjectUrl);
        setFailed(false);
      } catch (error) {
        if (controller.signal.aborted) return;
        setReason(error instanceof Error ? error.message : 'Фото недоступно');
        setFailed(true);
      }
    };

    void load();

    return () => {
      controller.abort();
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
    };
  }, [needsAuth, photo.isBroken, photo.unavailableReason, thumbnailUrl]);

  const visibleUrl = needsAuth ? objectUrl : thumbnailUrl;
  const canOpen = Boolean(!failed && visibleUrl);

  if (!visibleUrl || failed) {
    return (
      <div
        className={cn(
          'flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-secondary/70 px-3 py-4 text-center text-xs text-muted-foreground',
          fallbackClassName,
        )}
      >
        <ImageOff className="h-5 w-5" />
        <span className="font-medium text-foreground">Фото недоступно</span>
        <span>{reason || 'Ссылка повреждена'}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={cn('block overflow-hidden rounded-lg border border-border bg-card text-left', className)}
      onClick={() => {
        if (canOpen && onOpen) onOpen(visibleUrl);
      }}
    >
      <img
        src={visibleUrl}
        alt={alt}
        className={imgClassName}
        onError={() => {
          setReason('Файл не удалось загрузить');
          setFailed(true);
        }}
      />
    </button>
  );
}
