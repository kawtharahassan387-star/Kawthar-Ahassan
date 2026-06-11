export enum Category {
  STATIONERY = 'STATIONERY', // Papeterie
  OFFICE_EQUIPMENT = 'OFFICE_EQUIPMENT', // Matériel de bureau
  CONSUMABLES = 'CONSUMABLES', // Consommables (encre, etc)
  FURNITURE = 'FURNITURE', // Mobilier
  MAINTENANCE = 'MAINTENANCE', // Entretien
  DRH = 'DRH', // Direction des Ressources Humaines
  SRH = 'SRH', // Service des Ressources Humaines
  SFC = 'SFC', // Service Financier et Comptable
  OTHER = 'OTHER',
}

export enum TransactionType {
  INCOMING = 'INCOMING', // Entrée de stock (Achat/Livraison)
  OUTGOING = 'OUTGOING', // Sortie de stock (Dotation/Distribution)
}

export type SupplyRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface SupplyRequest {
  id: string;
  itemId: string;
  itemName: string;
  itemCategory: Category;
  requestedQuantity: number;
  requesterName: string;
  requesterDepartment: Category;
  requestDate: number;
  status: SupplyRequestStatus;
  validatedQuantity?: number; // Quantité Perçue
  validationDate?: number; // En Date
  observation?: string;
}

export interface InventoryItem {
  id: string;
  nProduit: string;
  name: string;
  category: Category;
  quantity: number;
  unit: string;
  minStock: number;
  lastUpdated: number;
  location?: string;
  observation?: string;
  qteRecuDRH?: number; // Qte recu f DRH
  qteSrh?: number;     // Qte srh (RH)
  qteSfc?: number;     // Qte sfc (FC)
  demandeSrh?: number; // Demande srh
  demandeSfc?: number; // Demande sfc
}

export interface Transaction {
  id: string;
  itemId: string;
  itemName: string;
  type: TransactionType;
  quantity: number;
  date: number;
  designationPrestation: string;
  observation: string;
}
