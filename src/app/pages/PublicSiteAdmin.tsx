import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Globe2, ImagePlus, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { publicSiteService, PUBLIC_SITE_URL } from '../services/public-site.service';
import type { PublicSiteContent, PublicSiteLift } from '../types/public-site';

const textareaClass = 'min-h-[92px] w-full rounded-md border border-input bg-input-background px-3 py-2 text-sm text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40';
const selectClass = 'h-9 w-full rounded-md border border-input bg-input-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40';

const emptyLift: PublicSiteLift = {
  slug: '', name: '', category: 'Ножничные подъёмники', categoryShort: 'Ножничный', workingHeight: 10,
  platformHeight: 8, capacity: 230, platformSize: '', weight: 0, engine: 'Электрический', drive: '2WD',
  use: 'Помещение', surface: 'Ровный твёрдый пол', manufacturer: 'Mantall', availability: 'available',
  price: 0, popularity: 50, image: '', gallery: [], purpose: '', limits: [], benefits: [], published: true,
};

function Field({ label, value, onChange, wide = false, multiline = false }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean; multiline?: boolean }) {
  return <label className={`space-y-1.5 ${wide ? 'md:col-span-2' : ''}`}>
    <span className="text-xs font-medium text-muted-foreground">{label}</span>
    {multiline
      ? <textarea className={textareaClass} value={value} onChange={event => onChange(event.target.value)} />
      : <Input value={value} onChange={event => onChange(event.target.value)} />}
  </label>;
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">{label}</span><Input type="number" min="0" step="any" value={value} onChange={event => onChange(Number(event.target.value))} /></label>;
}

const lines = (value: string) => value.split('\n').map(item => item.trim()).filter(Boolean);
const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');

export default function PublicSiteAdmin() {
  const query = useQuery({ queryKey: ['public-site-cms'], queryFn: publicSiteService.get, staleTime: 30_000 });
  const [content, setContent] = React.useState<PublicSiteContent | null>(null);
  const [equipment, setEquipment] = React.useState<PublicSiteLift[]>([]);
  const [selectedSlug, setSelectedSlug] = React.useState('');
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [message, setMessage] = React.useState('');

  React.useEffect(() => {
    if (!query.data?.content || !query.data.equipment || content) return;
    setContent(query.data.content);
    setEquipment(query.data.equipment);
    setSelectedSlug(query.data.equipment[0]?.slug || '');
  }, [content, query.data]);

  const selectedIndex = equipment.findIndex(item => item.slug === selectedSlug);
  const selected = selectedIndex >= 0 ? equipment[selectedIndex] : null;
  const touch = () => { setDirty(true); setMessage(''); };
  const updateContent = (updater: (value: PublicSiteContent) => PublicSiteContent) => {
    setContent(current => current ? updater(current) : current); touch();
  };
  const updateLift = <K extends keyof PublicSiteLift>(key: K, value: PublicSiteLift[K]) => {
    if (selectedIndex < 0) return;
    setEquipment(current => current.map((item, index) => index === selectedIndex ? { ...item, [key]: value } : item));
    if (key === 'slug') setSelectedSlug(String(value));
    touch();
  };

  async function save() {
    if (!content) return;
    setSaving(true); setMessage('');
    try {
      const result = await publicSiteService.save(content, equipment);
      setDirty(false);
      setMessage(`Опубликовано ${new Date(result.updatedAt).toLocaleString('ru-RU')}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось опубликовать изменения');
    } finally {
      setSaving(false);
    }
  }

  function addLift() {
    const id = `new-model-${Date.now()}`;
    const next = { ...emptyLift, slug: id, name: 'Новая модель', gallery: [], limits: [], benefits: [] };
    setEquipment(current => [...current, next]); setSelectedSlug(id); touch();
  }

  function removeLift() {
    if (!selected || !window.confirm(`Удалить «${selected.name}» из публичного каталога?`)) return;
    const remaining = equipment.filter((_, index) => index !== selectedIndex);
    setEquipment(remaining); setSelectedSlug(remaining[0]?.slug || ''); touch();
  }

  async function uploadImage(file: File | undefined) {
    if (!file || !selected) return;
    if (file.size > 8 * 1024 * 1024) return setMessage('Фотография должна быть не больше 8 МБ');
    setUploading(true); setMessage('Загружаем фотографию…');
    try {
      const result = await publicSiteService.uploadImage(file);
      updateLift('image', result.url);
      if (selected.gallery.length === 0) updateLift('gallery', [result.url]);
      setMessage('Фотография загружена. Нажмите «Опубликовать изменения».');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось загрузить фотографию');
    } finally {
      setUploading(false);
    }
  }

  if (query.isError) return <div className="mx-auto mt-16 max-w-xl rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">Не удалось загрузить публичный сайт. Обновите страницу или попробуйте позже.</div>;
  if (query.isLoading || !content) return <div className="flex min-h-[60vh] items-center justify-center gap-3 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Загружаем содержимое сайта…</div>;

  const company = content.company;
  return <div className="mx-auto w-full max-w-[1500px] space-y-6 p-4 sm:p-6 lg:p-8">
    <div className="flex flex-col gap-4 rounded-2xl border border-border/80 bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-4"><div className="rounded-xl bg-primary/10 p-3 text-primary"><Globe2 className="h-6 w-6" /></div><div><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">Управление публичным сайтом</h1><Badge variant="secondary">Только администратор</Badge></div><p className="mt-1 text-sm text-muted-foreground">Контакты, тексты, услуги, каталог и фотографии на skytech-rent.ru.</p>{query.data?.updatedAt && <p className="mt-1 text-xs text-muted-foreground">Последняя публикация: {new Date(query.data.updatedAt).toLocaleString('ru-RU')}</p>}</div></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" asChild><a href={PUBLIC_SITE_URL} target="_blank" rel="noreferrer">Открыть сайт <ExternalLink className="ml-2 h-4 w-4" /></a></Button><Button onClick={save} disabled={saving || !dirty}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Опубликовать изменения</Button></div>
    </div>
    {message && <div className={`rounded-xl border px-4 py-3 text-sm ${message.startsWith('Опубликовано') || message.includes('загружена') ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-border bg-muted/50 text-foreground'}`}>{message}</div>}

    <Tabs defaultValue="content" className="space-y-5">
      <TabsList className="h-auto flex-wrap"><TabsTrigger value="content">Тексты и контакты</TabsTrigger><TabsTrigger value="services">Услуги</TabsTrigger><TabsTrigger value="equipment">Каталог техники <Badge className="ml-2" variant="secondary">{equipment.length}</Badge></TabsTrigger></TabsList>

      <TabsContent value="content" className="space-y-5">
        <Card><CardHeader><CardTitle>Компания и контакты</CardTitle><CardDescription>Эти данные используются в шапке, подвале и на странице контактов.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Название компании" value={company.name} onChange={value => updateContent(old => ({ ...old, company: { ...old.company, name: value } }))} />
          <Field label="Подпись под логотипом" value={company.descriptor} onChange={value => updateContent(old => ({ ...old, company: { ...old.company, descriptor: value } }))} />
          <Field label="Телефон" value={company.phone} onChange={value => updateContent(old => ({ ...old, company: { ...old.company, phone: value } }))} />
          <Field label="Телефон для ссылки" value={company.phoneHref} onChange={value => updateContent(old => ({ ...old, company: { ...old.company, phoneHref: value } }))} />
          <Field label="Email" value={company.email} onChange={value => updateContent(old => ({ ...old, company: { ...old.company, email: value } }))} />
          <Field label="Часы работы" value={company.hours} onChange={value => updateContent(old => ({ ...old, company: { ...old.company, hours: value } }))} />
          <Field label="WhatsApp — ссылка или номер" value={company.whatsapp} onChange={value => updateContent(old => ({ ...old, company: { ...old.company, whatsapp: value } }))} />
          <Field label="Telegram — ссылка или имя" value={company.telegram} onChange={value => updateContent(old => ({ ...old, company: { ...old.company, telegram: value } }))} />
          <Field label="Адрес" wide multiline value={company.address} onChange={value => updateContent(old => ({ ...old, company: { ...old.company, address: value } }))} />
          <Field label="Реквизиты" wide multiline value={company.legal} onChange={value => updateContent(old => ({ ...old, company: { ...old.company, legal: value } }))} />
          <Field label="Города работы — по одному в строке" wide multiline value={company.cities.join('\n')} onChange={value => updateContent(old => ({ ...old, company: { ...old.company, cities: lines(value) } }))} />
          <Field label="Уведомление сверху (пустое поле скрывает его)" wide value={content.demoNotice} onChange={value => updateContent(old => ({ ...old, demoNotice: value }))} />
          <Field label="Описание в подвале" wide multiline value={content.footerText} onChange={value => updateContent(old => ({ ...old, footerText: value }))} />
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Главная страница</CardTitle><CardDescription>Основное предложение и призывы к заявке.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">
          {Object.entries(content.home).map(([key, value]) => <Field key={key} label={homeLabels[key] || key} value={value} wide={value.length > 70} multiline={value.length > 70} onChange={next => updateContent(old => ({ ...old, home: { ...old.home, [key]: next } }))} />)}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Каталог</CardTitle><CardDescription>Заголовки и подсказка на странице каталога.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">
          {Object.entries(content.catalog).map(([key, value]) => <Field key={key} label={catalogLabels[key] || sectionLabels[key] || key} value={value} wide={value.length > 70} multiline={value.length > 70} onChange={next => updateContent(old => ({ ...old, catalog: { ...old.catalog, [key]: next } }))} />)}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>О компании и контакты</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">
          {(['about', 'contacts'] as const).flatMap(section => Object.entries(content[section]).map(([key, value]) => <Field key={`${section}-${key}`} label={`${section === 'about' ? 'О компании' : 'Контакты'} · ${sectionLabels[key] || key}`} value={value} wide={value.length > 70} multiline={value.length > 70} onChange={next => updateContent(old => ({ ...old, [section]: { ...old[section], [key]: next } }))} />))}
        </CardContent></Card>
      </TabsContent>

      <TabsContent value="services" className="space-y-5">
        <Card><CardHeader><CardTitle>Страница услуг</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">{Object.entries(content.servicesPage).map(([key, value]) => <Field key={key} label={sectionLabels[key] || key} value={value} wide={value.length > 70} multiline={value.length > 70} onChange={next => updateContent(old => ({ ...old, servicesPage: { ...old.servicesPage, [key]: next } }))} />)}</CardContent></Card>
        <div className="grid gap-4 lg:grid-cols-2">{content.services.map((service, index) => <Card key={index}><CardHeader className="pb-3"><div className="flex items-center justify-between"><CardTitle className="text-base">Услуга {index + 1}</CardTitle><Button variant="ghost" size="sm" onClick={() => updateContent(old => ({ ...old, services: old.services.filter((_, i) => i !== index) }))}><Trash2 className="h-4 w-4" /></Button></div></CardHeader><CardContent className="space-y-4"><Field label="Название" value={service.title} onChange={value => updateContent(old => ({ ...old, services: old.services.map((item, i) => i === index ? { ...item, title: value } : item) }))} /><Field label="Описание" value={service.text} multiline onChange={value => updateContent(old => ({ ...old, services: old.services.map((item, i) => i === index ? { ...item, text: value } : item) }))} /></CardContent></Card>)}</div>
        <Button variant="outline" onClick={() => updateContent(old => ({ ...old, services: [...old.services, { title: 'Новая услуга', text: '' }] }))}><Plus className="mr-2 h-4 w-4" />Добавить услугу</Button>
      </TabsContent>

      <TabsContent value="equipment">
        <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
          <Card className="h-fit"><CardHeader className="pb-3"><div className="flex items-center justify-between"><CardTitle className="text-base">Модели</CardTitle><Button size="sm" variant="outline" onClick={addLift}><Plus className="mr-1 h-4 w-4" />Добавить</Button></div></CardHeader><CardContent className="max-h-[70vh] space-y-1 overflow-y-auto">{equipment.map(item => <button key={item.slug} type="button" onClick={() => setSelectedSlug(item.slug)} className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${selectedSlug === item.slug ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-muted'}`}><span className="block text-sm font-medium">{item.name}</span><span className="mt-0.5 block text-xs text-muted-foreground">{item.published === false ? 'Скрыта' : `${item.workingHeight} м · ${item.price.toLocaleString('ru-RU')} ₽/сутки`}</span></button>)}</CardContent></Card>
          {selected ? <Card><CardHeader><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle>{selected.name || 'Новая модель'}</CardTitle><CardDescription>Характеристики, цена, статус и фотография карточки.</CardDescription></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.published !== false} onChange={event => updateLift('published', event.target.checked)} /> Опубликована</label></div></CardHeader><CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Название" value={selected.name} onChange={value => updateLift('name', value)} />
              <Field label="Адрес страницы" value={selected.slug} onChange={value => updateLift('slug', slugify(value))} />
              <Field label="Категория" value={selected.category} onChange={value => updateLift('category', value)} />
              <Field label="Короткая категория" value={selected.categoryShort} onChange={value => updateLift('categoryShort', value)} />
              <Field label="Производитель" value={selected.manufacturer} onChange={value => updateLift('manufacturer', value)} />
              <Field label="Размер платформы" value={selected.platformSize} onChange={value => updateLift('platformSize', value)} />
              <NumberField label="Рабочая высота, м" value={selected.workingHeight} onChange={value => updateLift('workingHeight', value)} />
              <NumberField label="Высота платформы, м" value={selected.platformHeight} onChange={value => updateLift('platformHeight', value)} />
              <NumberField label="Грузоподъёмность, кг" value={selected.capacity} onChange={value => updateLift('capacity', value)} />
              <NumberField label="Масса, кг" value={selected.weight} onChange={value => updateLift('weight', value)} />
              <NumberField label="Цена от, ₽/сутки" value={selected.price} onChange={value => updateLift('price', value)} />
              <NumberField label="Популярность, 0–100" value={selected.popularity} onChange={value => updateLift('popularity', value)} />
              <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Двигатель</span><select className={selectClass} value={selected.engine} onChange={event => updateLift('engine', event.target.value as PublicSiteLift['engine'])}><option>Электрический</option><option>Дизельный</option></select></label>
              <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Привод</span><select className={selectClass} value={selected.drive} onChange={event => updateLift('drive', event.target.value as PublicSiteLift['drive'])}><option>2WD</option><option>4WD</option></select></label>
              <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Использование</span><select className={selectClass} value={selected.use} onChange={event => updateLift('use', event.target.value as PublicSiteLift['use'])}><option>Помещение</option><option>Улица</option><option>Помещение и улица</option></select></label>
              <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Статус</span><select className={selectClass} value={selected.availability} onChange={event => updateLift('availability', event.target.value as PublicSiteLift['availability'])}><option value="available">Доступен</option><option value="order">Под заказ</option><option value="busy">Занят</option></select></label>
              <Field label="Поверхность" wide value={selected.surface} onChange={value => updateLift('surface', value)} />
              <Field label="Назначение" wide multiline value={selected.purpose} onChange={value => updateLift('purpose', value)} />
              <Field label="Преимущества — по одному в строке" wide multiline value={selected.benefits.join('\n')} onChange={value => updateLift('benefits', lines(value))} />
              <Field label="Ограничения — по одному в строке" wide multiline value={selected.limits.join('\n')} onChange={value => updateLift('limits', lines(value))} />
            </div>
            <div className="grid gap-4 rounded-xl border border-border bg-muted/20 p-4 md:grid-cols-[220px_minmax(0,1fr)]"><div className="aspect-[4/3] overflow-hidden rounded-lg bg-muted">{selected.image ? <img src={selected.image} alt="Предпросмотр" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Нет фотографии</div>}</div><div className="space-y-3"><label className="inline-flex"><span className="inline-flex h-9 cursor-pointer items-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent"><ImagePlus className="mr-2 h-4 w-4" />{uploading ? 'Загружаем…' : 'Загрузить фотографию'}</span><input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/avif" disabled={uploading} onChange={event => uploadImage(event.target.files?.[0])} /></label><Field label="URL главной фотографии" value={selected.image} onChange={value => updateLift('image', value)} /><Field label="Галерея — URL по одному в строке" multiline value={selected.gallery.join('\n')} onChange={value => updateLift('gallery', lines(value))} /></div></div>
            <div className="flex justify-end"><Button variant="destructive" onClick={removeLift}><Trash2 className="mr-2 h-4 w-4" />Удалить модель</Button></div>
          </CardContent></Card> : <Card><CardContent className="py-16 text-center text-muted-foreground">Добавьте первую модель техники.</CardContent></Card>}
        </div>
      </TabsContent>
    </Tabs>
    <div className="sticky bottom-4 flex justify-end"><Button size="lg" className="shadow-xl" onClick={save} disabled={saving || !dirty}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Опубликовать изменения</Button></div>
  </div>;
}

const homeLabels: Record<string, string> = { eyebrow: 'Надзаголовок', title: 'Главный заголовок', description: 'Описание', categoriesTitle: 'Заголовок категорий', categoriesDescription: 'Описание категорий', popularTitle: 'Популярная техника', selectionTitle: 'Заголовок подбора', selectionDescription: 'Описание подбора', requestTitle: 'Заголовок заявки', requestDescription: 'Описание заявки' };
const sectionLabels: Record<string, string> = { eyebrow: 'Надзаголовок', title: 'Заголовок', description: 'Описание', requestTitle: 'Заголовок заявки', requestDescription: 'Описание заявки', storyTitle: 'Заголовок истории', storyText: 'Текст истории', mapTitle: 'Заголовок карты', mapDescription: 'Описание карты' };
const catalogLabels: Record<string, string> = { helperTitle: 'Заголовок блока помощи', helperDescription: 'Описание блока помощи' };
