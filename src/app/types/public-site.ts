export type PublicSiteCompany = {
  name: string;
  descriptor: string;
  phone: string;
  phoneHref: string;
  email: string;
  hours: string;
  whatsapp: string;
  telegram: string;
  address: string;
  legal: string;
  cities: string[];
};

export type PublicSiteContent = {
  company: PublicSiteCompany;
  demoNotice: string;
  footerText: string;
  home: {
    eyebrow: string;
    title: string;
    description: string;
    categoriesTitle: string;
    categoriesDescription: string;
    popularTitle: string;
    selectionTitle: string;
    selectionDescription: string;
    requestTitle: string;
    requestDescription: string;
  };
  catalog: { eyebrow: string; title: string; description: string; helperTitle: string; helperDescription: string };
  servicesPage: { eyebrow: string; title: string; description: string; requestTitle: string; requestDescription: string };
  about: { eyebrow: string; title: string; description: string; storyTitle: string; storyText: string };
  contacts: { eyebrow: string; title: string; description: string; mapTitle: string; mapDescription: string };
  services: Array<{ title: string; text: string }>;
};

export type PublicSiteLift = {
  slug: string;
  name: string;
  category: string;
  categoryShort: string;
  workingHeight: number;
  platformHeight: number;
  capacity: number;
  platformSize: string;
  weight: number;
  engine: 'Электрический' | 'Дизельный';
  drive: '2WD' | '4WD';
  use: 'Помещение' | 'Улица' | 'Помещение и улица';
  surface: string;
  manufacturer: string;
  availability: 'available' | 'order' | 'busy';
  price: number;
  popularity: number;
  image: string;
  gallery: string[];
  purpose: string;
  limits: string[];
  benefits: string[];
  published?: boolean;
};

export type PublicSiteCms = {
  content: PublicSiteContent | null;
  equipment: PublicSiteLift[] | null;
  updatedAt: string | null;
  version: string;
};
