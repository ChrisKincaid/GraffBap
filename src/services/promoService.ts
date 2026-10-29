import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';

export interface PromoAd {
  id: string;
  imageUrl: string;
  linkUrl: string;
  status: 'active' | 'inactive';
  props?: number;
  toys?: number;
  createdAt?: number;
}

export class PromoService {
  private activeAds: PromoAd[] = [];
  private currentIndex = 0;
  private frequency = 12;

  async init(): Promise<void> {
    const [settings, snapshot] = await Promise.all([
      getDoc(doc(db, 'system', 'promo_settings')),
      getDocs(query(collection(db, 'promo_ads'), where('status', '==', 'active'))),
    ]);
    const frequency: unknown = settings.exists() ? settings.get('frequency') : 12;
    if (typeof frequency !== 'number' || !Number.isInteger(frequency) || frequency < 0 || frequency > 100) {
      throw new Error('Promo frequency must be a whole number from 0 to 100.');
    }
    const ads = snapshot.docs.map(document => {
      const data = document.data();
      if (typeof data.imageUrl !== 'string' || !data.imageUrl.trim() ||
          typeof data.linkUrl !== 'string' || !data.linkUrl.trim() || data.status !== 'active') {
        throw new Error(`Invalid promo ad: ${document.id}`);
      }
      return {
        id: document.id, imageUrl: data.imageUrl, linkUrl: data.linkUrl, status: data.status,
        props: typeof data.props === 'number' ? data.props : 0,
        toys: typeof data.toys === 'number' ? data.toys : 0,
        createdAt: typeof data.createdAt === 'number' ? data.createdAt : undefined,
      } satisfies PromoAd;
    });
    this.shuffle(ads);
    this.activeAds = ads;
    this.frequency = frequency;
    this.currentIndex = 0;
  }

  getNextAd(): PromoAd | null {
    if (!this.activeAds.length) return null;
    if (this.currentIndex >= this.activeAds.length) {
      this.shuffle(this.activeAds);
      this.currentIndex = 0;
    }
    const ad = this.activeAds[this.currentIndex++]!;
    return { ...ad };
  }

  getFrequency(): number {
    return this.frequency;
  }

  private shuffle(ads: PromoAd[]): void {
    for (let i = ads.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ads[i], ads[j]] = [ads[j]!, ads[i]!];
    }
  }
}
