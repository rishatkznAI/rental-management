import React from 'react';
import { Camera, KeyRound, Save, UserCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { useAuth } from '../contexts/AuthContext';
import { profileService } from '../services/profile.service';

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

export default function ProfileSettings() {
  const { user, refreshUser } = useAuth();
  const [name, setName] = React.useState(user?.name || '');
  const [photo, setPhoto] = React.useState(user?.profilePhoto || '');
  const [about, setAbout] = React.useState('');
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [isSavingProfile, setIsSavingProfile] = React.useState(false);
  const [isSavingPassword, setIsSavingPassword] = React.useState(false);

  React.useEffect(() => {
    setName(user?.name || '');
    setPhoto(user?.profilePhoto || '');
  }, [user?.name, user?.profilePhoto]);

  async function handlePhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    setPhoto(dataUrl);
  }

  async function handleSaveProfile() {
    if (!name.trim()) {
      toast.error('Введите имя сотрудника.');
      return;
    }
    setIsSavingProfile(true);
    try {
      await profileService.updateProfile({
        name: name.trim(),
        profilePhoto: photo || undefined,
      });
      await refreshUser();
      toast.success('Личные настройки сохранены.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сохранить профиль.');
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function handleChangePassword() {
    if (!currentPassword || !newPassword) {
      toast.error('Заполните текущий и новый пароль.');
      return;
    }
    if (newPassword.length < 4) {
      toast.error('Новый пароль должен быть не короче 4 символов.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Подтверждение пароля не совпадает.');
      return;
    }

    setIsSavingPassword(true);
    try {
      await profileService.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Пароль обновлён.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сменить пароль.');
    } finally {
      setIsSavingPassword(false);
    }
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 md:p-8">
      <div>
        <h1 className="text-3xl font-black tracking-tight text-foreground">Личные настройки</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground sm:text-base">
          Здесь сотрудник может обновить фото профиля, имя для интерфейса и сменить пароль своей учётной записи.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <Card className="border-border/70 bg-card/70">
          <CardHeader>
            <CardTitle>Профиль сотрудника</CardTitle>
            <CardDescription>Данные отображаются в боковой панели и в рабочих карточках системы.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-border/70 bg-background/70">
                {photo ? (
                  <img src={photo} alt={name || 'Профиль'} className="h-full w-full object-cover" />
                ) : (
                  <UserCircle2 className="h-12 w-12 text-muted-foreground" />
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <label>
                  <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
                  <span className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-border/70 bg-background px-4 text-sm font-medium hover:bg-accent">
                    <Camera className="h-4 w-4" />
                    Загрузить фото
                  </span>
                </label>
                {photo ? (
                  <Button type="button" variant="ghost" className="rounded-full" onClick={() => setPhoto('')}>
                    Убрать фото
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="text-sm font-medium text-foreground">Имя</div>
                <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Как отображать сотрудника в системе" />
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium text-foreground">Email</div>
                <Input value={user?.email || ''} readOnly className="cursor-not-allowed opacity-80" />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="text-sm font-medium text-foreground">Роль</div>
                <Input value={user?.role || ''} readOnly className="cursor-not-allowed opacity-80" />
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium text-foreground">О себе</div>
                <Textarea
                  rows={3}
                  value={about}
                  onChange={(event) => setAbout(event.target.value)}
                  placeholder="Личное поле для заметок. Пока только локально в текущем браузере."
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                className="rounded-full bg-lime-300 text-slate-950 hover:bg-lime-200"
                onClick={() => void handleSaveProfile()}
                disabled={isSavingProfile}
              >
                <Save className="h-4 w-4" />
                Сохранить профиль
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/70">
          <CardHeader>
            <CardTitle>Смена пароля</CardTitle>
            <CardDescription>Пароль меняется только для вашей учётной записи.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">Текущий пароль</div>
              <Input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">Новый пароль</div>
              <Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">Подтверждение нового пароля</div>
              <Input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            </div>
            <Button
              type="button"
              className="w-full rounded-full bg-cyan-300 text-slate-950 hover:bg-cyan-200"
              onClick={() => void handleChangePassword()}
              disabled={isSavingPassword}
            >
              <KeyRound className="h-4 w-4" />
              Обновить пароль
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
