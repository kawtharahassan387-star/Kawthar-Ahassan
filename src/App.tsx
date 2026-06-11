import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Package,
  ArrowUpRight,
  ArrowDownLeft,
  LayoutDashboard,
  Plus,
  Search,
  Filter,
  History,
  MoreVertical,
  TrendingUp,
  AlertTriangle,
  ClipboardList,
  LogOut,
  ChevronRight,
  Database,
  ArrowRightLeft,
  XCircle,
  CheckCircle2,
  Lock,
  Eye,
  EyeOff,
  User,
  LogIn,
  Mail,
  Smartphone,
  FileText,
  Wifi,
  WifiOff,
  Calculator,
  Trash2,
  Printer,
  Download,
  CalendarRange,
  FileSpreadsheet,
} from "lucide-react";
import {
  Category,
  TransactionType,
  type InventoryItem,
  type Transaction,
  type SupplyRequest,
  type SupplyRequestStatus,
} from "./types";
import { PasswordSetupForm, PasswordUnlockForm } from "./components/LockScreen";
import {
  auth,
  db,
  loginWithGoogle,
  logout,
  loginWithEmail,
  registerWithEmail,
} from "./lib/firebase";
import { onAuthStateChanged, type User as FirebaseUser, updateProfile } from "firebase/auth";
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  where,
  runTransaction,
  getDoc,
  setDoc,
  getDocFromCache,
} from "firebase/firestore";

// --- Components ---

function StatCard({
  icon,
  label,
  value,
  subValue,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subValue?: string;
  color: "blue" | "emerald" | "amber" | "rose";
}) {
  const colors = {
    blue: "bg-blue-50 text-blue-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    rose: "bg-rose-50 text-rose-600",
  };

  return (
    <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm group hover:-translate-y-1 transition-all duration-300">
      <div
        className={`p-4 rounded-2xl w-fit mb-4 transition-transform group-hover:scale-110 ${colors[color]}`}
      >
        {icon}
      </div>
      <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">
        {label}
      </p>
      <div className="flex items-baseline gap-2">
        <p className="text-3xl font-black text-slate-900 tracking-tight">
          {value}
        </p>
        {subValue && (
          <span className="text-xs font-bold text-slate-300">{subValue}</span>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ type }: { type: TransactionType }) {
  const isIncoming = type === TransactionType.INCOMING;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${
        isIncoming
          ? "bg-emerald-50 text-emerald-600 border-emerald-100"
          : "bg-rose-50 text-rose-600 border-rose-100"
      }`}
    >
      {isIncoming ? <ArrowDownLeft size={12} /> : <ArrowUpRight size={12} />}
      {isIncoming ? "Entrée" : "Sortie"}
    </span>
  );
}

const getItemRemainingStock = (item: InventoryItem): number => {
  if (item.category === Category.DRH) {
    const qteDRH = Number(item.qteRecuDRH) || 0;
    const qteS = Number(item.qteSrh) || 0;
    const qteF = Number(item.qteSfc) || 0;
    return Math.max(0, qteDRH - (qteS + qteF));
  }
  if (item.category === Category.SRH) {
    return Number(item.qteSrh) || 0;
  }
  if (item.category === Category.SFC) {
    return Number(item.qteSfc) || 0;
  }
  return Number(item.quantity) || 0;
};

// --- Main Application ---

export default function App() {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<
    | "dashboard"
    | "inventory"
    | "history"
    | "drh"
    | "srh"
    | "sfc"
    | "entrées"
    | "sorties"
    | "reste_stock"
    | "demandes"
    | "distribution"
    | "rapport_mensuel"
  >("dashboard");

  // Filter states for Monthly Report
  const [reportMonth, setReportMonth] = useState<number>(new Date().getMonth());
  const [reportYear, setReportYear] = useState<number>(new Date().getFullYear());
  const [reportDept, setReportDept] = useState<"ALL" | Category.DRH | Category.SRH | Category.SFC>("ALL");
  const [reportSubTab, setReportSubTab] = useState<"summary" | "requests" | "distributions">("summary");

  // Data States
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [supplyRequests, setSupplyRequests] = useState<SupplyRequest[]>([]);

  // UI States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<
    | "addItem"
    | "updateStock"
    | "quickMovement"
    | "createSupplyRequest"
    | "validateSupplyRequest"
    | "changePassword"
    | "editServiceSupply"
    | "deleteItem"
    | "auth"
    | null
  >(null);
  const [quickMovementType, setQuickMovementType] = useState<TransactionType>(
    TransactionType.INCOMING,
  );
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [selectedSupplyRequest, setSelectedSupplyRequest] =
    useState<SupplyRequest | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<Category | "ALL">("ALL");

  // Automated Calculator States
  const [calcItemId, setCalcItemId] = useState<string>("");
  const [calcDailyRate, setCalcDailyRate] = useState<number>(5);
  const [distributionDrafts, setDistributionDrafts] = useState<
    Record<
      string,
      {
        qteRecuDRH: number;
        demandeSrh: number;
        demandeSfc: number;
        qteSrh: number;
        qteSfc: number;
        syncStock: boolean;
      }
    >
  >({});
  const [activeDistItemId, setActiveDistItemId] = useState<string>("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Online/Offline State Status
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Application Lock States
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [dbPassword, setDbPassword] = useState<string>("");
  const [isPasscodeConfigured, setIsPasscodeConfigured] =
    useState<boolean>(false);
  const [isCheckingPassword, setIsCheckingPassword] = useState<boolean>(false);
  const [registryTab, setRegistryTab] = useState<"stocks" | "flux">("stocks");

  // Fetch passcode on mount
  useEffect(() => {
    const fetchPassword = async () => {
      try {
        let configDoc = null;

        // 1. Try reading from local Firestore cache first (very fast, works offline)
        try {
          configDoc = await getDocFromCache(doc(db, "config", "app_lock"));
        } catch {
          // Silent catch: document not in cache or cached yet
        }

        // 2. If no cached doc and we are online, try fetching from server
        if (!configDoc && navigator.onLine) {
          configDoc = await getDoc(doc(db, "config", "app_lock"));
        }

        if (configDoc && configDoc.exists() && configDoc.data().password) {
          const pass = configDoc.data().password;
          setDbPassword(pass);
          setIsPasscodeConfigured(true);
          localStorage.setItem("stockpro_app_lock_password", pass);
        } else {
          // Check localstorage as fallback for non-existent doc or offline scenario
          const localPass = localStorage.getItem("stockpro_app_lock_password");
          if (localPass) {
            setDbPassword(localPass);
            setIsPasscodeConfigured(true);
          } else {
            setIsPasscodeConfigured(false);
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const isOfflineError =
          errMsg.includes("offline") ||
          errMsg.includes("unavailable") ||
          errMsg.includes("network") ||
          !navigator.onLine;

        if (isOfflineError) {
          console.info(
            "Info: Device is offline or network is unavailable. Attempting to load password from local storage.",
          );
        } else {
          console.warn("Error reading passcode from Firestore:", err);
        }

        // Fallback to local storage
        const localPass = localStorage.getItem("stockpro_app_lock_password");
        if (localPass) {
          setDbPassword(localPass);
          setIsPasscodeConfigured(true);
        } else {
          setIsPasscodeConfigured(false);
        }
      } finally {
        setIsCheckingPassword(false);
      }
    };
    fetchPassword();
  }, []);

  // Handle Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Sync with Firestore
  useEffect(() => {
    const unsubItems = onSnapshot(
      query(collection(db, "items"), orderBy("lastUpdated", "desc")),
      (snap) => {
        setItems(
          snap.docs.map(
            (doc) => ({ id: doc.id, ...doc.data() }) as InventoryItem,
          ),
        );
      },
    );

    const unsubTransactions = onSnapshot(
      query(collection(db, "transactions"), orderBy("date", "desc")),
      (snap) => {
        setTransactions(
          snap.docs.map(
            (doc) => ({ id: doc.id, ...doc.data() }) as Transaction,
          ),
        );
      },
    );

    const unsubSupplyRequests = onSnapshot(
      query(collection(db, "supply_requests"), orderBy("requestDate", "desc")),
      (snap) => {
        setSupplyRequests(
          snap.docs.map(
            (doc) => ({ id: doc.id, ...doc.data() }) as SupplyRequest,
          ),
        );
      },
    );

    return () => {
      unsubItems();
      unsubTransactions();
      unsubSupplyRequests();
    };
  }, []);

  // Derived Stats
  const stats = useMemo(() => {
    const totalItems = items.length;
    const lowStockItems = items.filter((i) => getItemRemainingStock(i) <= i.minStock).length;
    const todayTransactions = transactions.filter((t) => {
      const d = new Date(t.date);
      const today = new Date();
      return d.toDateString() === today.toDateString();
    });

    return {
      totalItems,
      lowStockItems,
      todayActivity: todayTransactions.length,
      outOfStock: items.filter((i) => getItemRemainingStock(i) === 0).length,
    };
  }, [items, transactions]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesSearch =
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.nProduit.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory =
        categoryFilter === "ALL" || item.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [items, searchQuery, categoryFilter]);

  // Derived datasets for the Monthly Report
  const filteredRequests = useMemo(() => {
    return supplyRequests.filter((req) => {
      const date = new Date(req.requestDate);
      const m = date.getMonth();
      const y = date.getFullYear();
      const matchesDate = m === reportMonth && y === reportYear;
      if (!matchesDate) return false;

      if (reportDept === "ALL") {
        return (
          req.requesterDepartment === Category.DRH ||
          req.requesterDepartment === Category.SRH ||
          req.requesterDepartment === Category.SFC
        );
      } else {
        return req.requesterDepartment === reportDept;
      }
    });
  }, [supplyRequests, reportMonth, reportYear, reportDept]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      if (t.type !== TransactionType.OUTGOING) return false;

      const date = new Date(t.date);
      const m = date.getMonth();
      const y = date.getFullYear();
      const matchesDate = m === reportMonth && y === reportYear;
      if (!matchesDate) return false;

      const item = items.find((i) => i.id === t.itemId);
      const itemCat = item?.category;
      const text = (t.designationPrestation + " " + t.observation).toUpperCase();

      let dept: Category | null = null;
      if (itemCat === Category.DRH || text.includes("DRH")) {
        dept = Category.DRH;
      } else if (itemCat === Category.SRH || text.includes("SRH")) {
        dept = Category.SRH;
      } else if (itemCat === Category.SFC || text.includes("SFC")) {
        dept = Category.SFC;
      }

      if (reportDept === "ALL") {
        return dept !== null;
      } else {
        return dept === reportDept;
      }
    });
  }, [transactions, items, reportMonth, reportYear, reportDept]);

  const consolidatedSummary = useMemo(() => {
    const summaryMap: {
      [itemId: string]: {
        itemId: string;
        itemName: string;
        category: string;
        unit: string;
        requestedQty: number;
        approvedQty: number;
        directExitQty: number;
      };
    } = {};

    filteredRequests.forEach((req) => {
      if (!summaryMap[req.itemId]) {
        const item = items.find((i) => i.id === req.itemId);
        summaryMap[req.itemId] = {
          itemId: req.itemId,
          itemName: req.itemName,
          category: req.itemCategory || item?.category || "",
          unit: item?.unit || "unité",
          requestedQty: 0,
          approvedQty: 0,
          directExitQty: 0,
        };
      }
      summaryMap[req.itemId].requestedQty += Number(req.requestedQuantity) || 0;
      if (req.status === "APPROVED") {
        summaryMap[req.itemId].approvedQty += Number(req.validatedQuantity ?? req.requestedQuantity) || 0;
      }
    });

    filteredTransactions.forEach((tx) => {
      if (!summaryMap[tx.itemId]) {
        const item = items.find((i) => i.id === tx.itemId);
        summaryMap[tx.itemId] = {
          itemId: tx.itemId,
          itemName: tx.itemName,
          category: item?.category || "",
          unit: item?.unit || "unité",
          requestedQty: 0,
          approvedQty: 0,
          directExitQty: 0,
        };
      }
      const isFormalValidation =
        tx.designationPrestation.toLowerCase().includes("approbation demande") ||
        tx.designationPrestation.toLowerCase().includes("approbation");
      if (!isFormalValidation) {
        summaryMap[tx.itemId].directExitQty += Number(tx.quantity) || 0;
      }
    });

    return Object.values(summaryMap);
  }, [filteredRequests, filteredTransactions, items]);

  const handlePrint = () => {
    const monthNames = [
      "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
      "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
    ];
    const deptLabels = {
      ALL: "Tous les Services (DRH, SRH, SFC)",
      DRH: "Direction des Ressources Humaines (DRH)",
      SRH: "Service des Ressources Humaines (SRH)",
      SFC: "Service Financier et Comptable (SFC)"
    };
    
    const html = `
      <html>
        <head>
          <title>Rapport Mensuel - ${monthNames[reportMonth]} ${reportYear}</title>
          <style>
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1e293b; padding: 40px; line-height: 1.5; }
            h1 { font-size: 24px; font-weight: 800; margin: 0 0 5px 0; color: #0f172a; text-transform: uppercase; letter-spacing: -0.5px; }
            h2 { font-size: 14px; font-weight: 600; color: #64748b; margin: 0 0 30px 0; letter-spacing: 1px; text-transform: uppercase; }
            .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 1px solid #e2e8f0; }
            .meta-item { font-size: 13px; font-weight: 500; }
            .meta-item strong { color: #0f172a; display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
            th { background: #f8fafc; border-bottom: 2px solid #e2e8f0; padding: 12px 16px; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; text-align: left; }
            td { padding: 12px 16px; border-bottom: 1px solid #f1f5f9; font-size: 12px; color: #334155; }
            .badge { display: inline-block; padding: 3px 8px; border-radius: 9999px; font-size: 9px; font-weight: 700; text-transform: uppercase; }
            .badge-approved { background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; }
            .badge-pending { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
            .badge-rejected { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
            .section-title { font-size: 16px; font-weight: 700; color: #0f172a; margin-top: 30px; margin-bottom: 15px; border-left: 4px solid #10b981; padding-left: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
            .footer { position: fixed; bottom: 20px; left: 40px; right: 40px; display: flex; justify-content: space-between; font-size: 9px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 10px; }
            @media print {
              body { padding: 0; }
              .no-print { display: none; }
              .footer { position: running(footer); }
            }
          </style>
        </head>
        <body>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
            <div>
              <h1>Rapport de Distribution Mensuelle</h1>
              <h2>StockPro - Suivi de Consommations Réseau</h2>
            </div>
            <div style="text-align: right; font-size: 11px; color: #64748b; line-height: 1.6;">
              <strong>Date d'Édition:</strong> ${new Date().toLocaleDateString('fr-FR')}<br/>
              <strong>Utilisateur:</strong> ${currentUser ? currentUser.email : 'Administrateur StockPro'}
            </div>
          </div>

          <div class="meta-grid">
            <div class="meta-item">
              <strong>Période Spécifiée</strong>
              Période de fin de mois : ${monthNames[reportMonth]} ${reportYear}
            </div>
            <div class="meta-item">
              <strong>Service(s) Concerné(s)</strong>
              ${deptLabels[reportDept as keyof typeof deptLabels] || reportDept}
            </div>
          </div>
          
          <div class="section-title">1. Récapitulatif Consolidé des Consommations</div>
          <table>
            <thead>
              <tr>
                <th>Désignation Article</th>
                <th>Catégorie d'Origine</th>
                <th>Demandes Formelles Déposées</th>
                <th>Demandes Approuvées & Reçues</th>
                <th>Dotations Directes Accordées</th>
                <th style="text-align: right;">Volume Total Mensuel Consommé</th>
              </tr>
            </thead>
            <tbody>
              ${
                consolidatedSummary.length === 0 
                  ? `<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 24px; font-style: italic;">Aucune consommation recensée pour cette période.</td></tr>` 
                  : consolidatedSummary.map(item => `
                    <tr>
                      <td style="font-weight: 700; color: #0f172a;">${item.itemName}</td>
                      <td><span style="font-size: 10px; font-weight: bold; background: #f1f5f9; padding: 3px 6px; border-radius: 4px; color: #475569;">${item.category}</span></td>
                      <td>${item.requestedQty} ${item.unit}</td>
                      <td style="font-weight: 600; color: #059669;">${item.approvedQty} ${item.unit}</td>
                      <td style="font-weight: 600; color: #dc2626;">${item.directExitQty} ${item.unit}</td>
                      <td style="text-align: right; font-weight: 800; color: #4f46e5; font-size: 13px;">${item.approvedQty + item.directExitQty} ${item.unit}</td>
                    </tr>
                  `).join("")
              }
            </tbody>
          </table>

          <div class="section-title">2. Registre Logistique des Demandes Formelles</div>
          <table>
            <thead>
              <tr>
                <th>Nom Demandeur</th>
                <th>Service Commanditaire</th>
                <th>Article Commandé</th>
                <th style="text-align: center;">Quantité Demandée</th>
                <th style="text-align: center;">Quantité Validée</th>
                <th style="text-align: center;">Date de Dépôt</th>
                <th>Statut de Validation</th>
                <th>Note d'Observation</th>
              </tr>
            </thead>
            <tbody>
              ${
                filteredRequests.length === 0 
                  ? `<tr><td colspan="8" style="text-align: center; color: #94a3b8; padding: 24px; font-style: italic;">Aucun formulaire de demande enregistré pour ce mois.</td></tr>` 
                  : filteredRequests.map(req => {
                      const statusClass = req.status === "APPROVED" ? "badge-approved" : req.status === "PENDING" ? "badge-pending" : "badge-rejected";
                      const statusLabel = req.status === "APPROVED" ? "Approuvé" : req.status === "PENDING" ? "En cours" : "Rejeté";
                      return `
                        <tr>
                          <td style="font-weight: 600;">${req.requesterName}</td>
                          <td style="font-weight: bold; color: #4f46e5;">${req.requesterDepartment}</td>
                          <td>${req.itemName}</td>
                          <td style="text-align: center;">${req.requestedQuantity}</td>
                          <td style="text-align: center; font-weight: bold;">${req.validatedQuantity !== undefined ? req.validatedQuantity : "-"}</td>
                          <td style="text-align: center;">${new Date(req.requestDate).toLocaleDateString('fr-FR')}</td>
                          <td><span class="badge ${statusClass}">${statusLabel}</span></td>
                          <td>${req.observation || "-"}</td>
                        </tr>
                      `;
                    }).join("")
              }
            </tbody>
          </table>

          <div class="section-title">3. Registre des Écritures de Dotations / Sorties Directes</div>
          <table>
            <thead>
              <tr>
                <th>Désignation Article</th>
                <th style="text-align: center;">Quantité Distribuée</th>
                <th style="text-align: center;">Date Dotation</th>
                <th>Prestation / Motif spécifié</th>
                <th>Notes d'Observations</th>
              </tr>
            </thead>
            <tbody>
              ${
                filteredTransactions.length === 0 
                  ? `<tr><td colspan="5" style="text-align: center; color: #94a3b8; padding: 24px; font-style: italic;">Aucun mouvement de dotation directe enregistré pour ce mois.</td></tr>` 
                  : filteredTransactions.map(t => {
                      return `
                        <tr>
                          <td style="font-weight: 700;">${t.itemName}</td>
                          <td style="text-align: center; color: #dc2626; font-weight: 700;">-${t.quantity}</td>
                          <td style="text-align: center;">${new Date(t.date).toLocaleDateString('fr-FR')}</td>
                          <td style="font-weight: 600; color: #475569;">${t.designationPrestation}</td>
                          <td>${t.observation || "-"}</td>
                        </tr>
                      `;
                    }).join("")
              }
            </tbody>
          </table>

          <div class="footer">
            <span>Rapport Officiel de Distribution Logistique - StockPro Enterprise</span>
            <span>Page 1 sur 1</span>
          </div>

          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `;

    // High compatibility printing method for sandboxed/iframe applications
    try {
      const printIframe = document.createElement("iframe");
      printIframe.id = "print-iframe-helper";
      printIframe.style.position = "fixed";
      printIframe.style.right = "0";
      printIframe.style.bottom = "0";
      printIframe.style.width = "0";
      printIframe.style.height = "0";
      printIframe.style.border = "0";
      document.body.appendChild(printIframe);

      const iframeDoc = printIframe.contentWindow?.document || printIframe.contentDocument;
      if (iframeDoc) {
        iframeDoc.open();
        iframeDoc.write(html);
        iframeDoc.close();

        setTimeout(() => {
          printIframe.contentWindow?.focus();
          printIframe.contentWindow?.print();
          setTimeout(() => {
            document.body.removeChild(printIframe);
          }, 1000);
        }, 500);
      } else {
        throw new Error("Unable to access iframe document");
      }
    } catch (e) {
      console.warn("Iframe printing failed, falling back to window.open:", e);
      const printWindow = window.open("", "_blank");
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
      } else {
        alert("Impossible d'imprimer. Veuillez autoriser les fenêtres contextuelles (popups) pour ce site.");
      }
    }
  };

  const handleExportCSV = () => {
    const monthNames = [
      "Janvier", "Fevrier", "Mars", "Avril", "Mai", "Juin",
      "Juillet", "Aout", "Septembre", "Octobre", "Novembre", "Decembre"
    ];
    let csvContent = "\uFEFF"; // Add BOM to support Excel UTF-8 representation
    csvContent += "RAPPORT MENSUEL DE DISTRIBUTION - " + monthNames[reportMonth].toUpperCase() + " " + reportYear + "\n";
    csvContent += "Service Filtré:;" + reportDept + "\n";
    csvContent += "Date de Generation:;" + new Date().toLocaleDateString('fr-FR') + "\n\n";

    csvContent += "1. RESUME CONSOLIDE DES FOURNITURES\n";
    csvContent += "Article;Categorie;Demandes Formelles Totales;Quantite Approuvee;Dotations Directes;Consommation Totale\n";
    
    consolidatedSummary.forEach(item => {
      csvContent += `"${item.itemName}";"${item.category}";"${item.requestedQty}";"${item.approvedQty}";"${item.directExitQty}";"${item.approvedQty + item.directExitQty}"\n`;
    });

    csvContent += "\n2. DETAIL DES DEMANDES DE FOURNITURES\n";
    csvContent += "Demandeur;Service Ordonnateur;Article;Quantite Demande;Quantite Validee;Date de Demande;Statut;Observation\n";
    
    filteredRequests.forEach(req => {
      csvContent += `"${req.requesterName}";"${req.requesterDepartment}";"${req.itemName}";"${req.requestedQuantity}";"${req.validatedQuantity ?? ""}";"${new Date(req.requestDate).toLocaleDateString('fr-FR')}";"${req.status}";"${req.observation ?? ""}"\n`;
    });

    csvContent += "\n3. REGISTRE DES DOTATIONS DIRECTES\n";
    csvContent += "Article;Quantite;Date;Prestation / Motif;Observation\n";

    filteredTransactions.forEach(t => {
      csvContent += `"${t.itemName}";"-${t.quantity}";"${new Date(t.date).toLocaleDateString('fr-FR')}";"${t.designationPrestation}";"${t.observation ?? ""}"\n`;
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `rapport_mensuel_${monthNames[reportMonth].toLowerCase()}_${reportYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Actions
  const handleAddItem = async (
    data: Partial<InventoryItem>,
    extraTx?: {
      qteRecu?: number;
      dateRecu?: string;
      qteNombre?: number;
      dateSortie?: string;
      demandeSrh?: number;
      demandeSfc?: number;
      qteSrh?: number;
      qteSfc?: number;
      observation?: string;
    },
  ) => {
    try {
      let initialQty = data.quantity || 0;
      let qteRecu = extraTx?.qteRecu || 0;
      const qteNombre = extraTx?.qteNombre || 0;

      // If the user specified a starting stock (initialQty) but didn't write an extra qteRecu on the right,
      // let's treat the entire initialQty as the incoming reception so that a transaction row gets recorded!
      let autoIncoming = false;
      if (initialQty > 0 && qteRecu === 0) {
        qteRecu = initialQty;
        initialQty = 0;
        autoIncoming = true;
      }

      const isServiceCategory = [Category.DRH, Category.SRH, Category.SFC].includes(data.category as Category);
      const itemDoc: any = {
        ...data,
        lastUpdated: Date.now(),
        observation: extraTx?.observation || data.observation || "",
      };

      if (data.category === Category.DRH) {
        // qteRecu counts as received for DRH
        itemDoc.qteRecuDRH = qteRecu;
        itemDoc.demandeSrh = extraTx?.demandeSrh || 0;
        itemDoc.demandeSfc = extraTx?.demandeSfc || 0;
        itemDoc.qteSrh = 0;
        itemDoc.qteSfc = 0;
        itemDoc.quantity = qteRecu; // balance is the raw received amount initially
      } else if (data.category === Category.SRH) {
        const dSrh = extraTx?.demandeSrh || qteNombre || 0;
        const qSrh = extraTx?.qteSrh || qteRecu || 0;
        itemDoc.demandeSrh = dSrh;
        itemDoc.qteSrh = qSrh;
        itemDoc.qteRecuDRH = qSrh; 
        itemDoc.demandeSfc = 0;
        itemDoc.qteSfc = 0;
        itemDoc.quantity = qSrh;
      } else if (data.category === Category.SFC) {
        const dSfc = extraTx?.demandeSfc || qteNombre || 0;
        const qSfc = extraTx?.qteSfc || qteRecu || 0;
        itemDoc.demandeSfc = dSfc;
        itemDoc.qteSfc = qSfc;
        itemDoc.qteRecuDRH = qSfc;
        itemDoc.demandeSrh = 0;
        itemDoc.qteSrh = 0;
        itemDoc.quantity = qSfc;
      } else {
        const finalQty = initialQty + qteRecu - qteNombre;
        itemDoc.quantity = finalQty < 0 ? 0 : finalQty;
      }

      const docRef = await addDoc(collection(db, "items"), itemDoc);
      const itemId = docRef.id;

      // Determine tx received quantity helper
      const actualRxQty = (data.category === Category.DRH)
        ? qteRecu
        : (data.category === Category.SRH)
        ? (extraTx?.qteSrh || qteRecu || 0)
        : (data.category === Category.SFC)
        ? (extraTx?.qteSfc || qteRecu || 0)
        : qteRecu;

      if (actualRxQty > 0) {
        const dateTimestamp = extraTx?.dateRecu
          ? new Date(extraTx.dateRecu).getTime()
          : Date.now();
        await addDoc(collection(db, "transactions"), {
          itemId,
          itemName: data.name || "",
          type: TransactionType.INCOMING,
          quantity: actualRxQty,
          date: dateTimestamp,
          designationPrestation: autoIncoming
            ? "Stock initial"
            : "Réception initiale",
          observation: extraTx?.observation || "",
        });
      }

      // Standard dotation initial transaction row (only for non services)
      if (!isServiceCategory && qteNombre > 0) {
        const dateTimestamp = extraTx?.dateSortie
          ? new Date(extraTx.dateSortie).getTime()
          : Date.now();
        await addDoc(collection(db, "transactions"), {
          itemId,
          itemName: data.name || "",
          type: TransactionType.OUTGOING,
          quantity: qteNombre,
          date: dateTimestamp,
          designationPrestation: "Dotation initiale",
          observation: extraTx?.observation || "",
        });
      }

      setIsModalOpen(false);
      showToast("Fourniture créée avec succès");
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateStock = async (
    itemId: string,
    amount: number,
    type: TransactionType,
    designationPrestation: string,
    observation: string = "",
  ) => {
    const itemRef = doc(db, "items", itemId);

    const executeNonTransactional = async (currentItemData: InventoryItem) => {
      const data = currentItemData;
      const currentQty = Number(data.quantity) || 0;
      let newQty = currentQty;
      const updateFields: any = {};

      if (data.category === Category.DRH) {
        const currentRecu = Number(data.qteRecuDRH) || 0;
        const currentSrh = Number(data.qteSrh) || 0;
        const currentSfc = Number(data.qteSfc) || 0;
        if (type === TransactionType.INCOMING) {
          updateFields.qteRecuDRH = currentRecu + amount;
          newQty = Math.max(0, (currentRecu + amount) - (currentSrh + currentSfc));
        } else {
          updateFields.qteRecuDRH = Math.max(0, currentRecu - amount);
          newQty = Math.max(0, Math.max(0, currentRecu - amount) - (currentSrh + currentSfc));
        }
      } else if (data.category === Category.SRH) {
        const currentSrh = Number(data.qteSrh) || 0;
        if (type === TransactionType.INCOMING) {
          updateFields.qteSrh = currentSrh + amount;
          updateFields.qteRecuDRH = currentSrh + amount;
          newQty = currentSrh + amount;
        } else {
          updateFields.qteSrh = Math.max(0, currentSrh - amount);
          updateFields.qteRecuDRH = Math.max(0, currentSrh - amount);
          newQty = Math.max(0, currentSrh - amount);
        }
      } else if (data.category === Category.SFC) {
        const currentSfc = Number(data.qteSfc) || 0;
        if (type === TransactionType.INCOMING) {
          updateFields.qteSfc = currentSfc + amount;
          updateFields.qteRecuDRH = currentSfc + amount;
          newQty = currentSfc + amount;
        } else {
          updateFields.qteSfc = Math.max(0, currentSfc - amount);
          updateFields.qteRecuDRH = Math.max(0, currentSfc - amount);
          newQty = Math.max(0, currentSfc - amount);
        }
      } else {
        newQty = type === TransactionType.INCOMING ? currentQty + amount : currentQty - amount;
      }

      if (newQty < 0) throw new Error("Stock insuffisant !");

      await updateDoc(itemRef, {
        ...updateFields,
        quantity: newQty,
        lastUpdated: Date.now(),
      });

      await addDoc(collection(db, "transactions"), {
        itemId,
        itemName: currentItemData.name,
        type,
        quantity: amount,
        date: Date.now(),
        designationPrestation: designationPrestation,
        observation: observation,
      });
      setIsModalOpen(false);
    };

    // Try transaction first if online
    if (navigator.onLine) {
      try {
        await runTransaction(db, async (transaction) => {
          const itemDoc = await transaction.get(itemRef);
          if (!itemDoc.exists()) throw new Error("Item does not exist!");

          const data = itemDoc.data() as InventoryItem;
          const currentQty = Number(data.quantity) || 0;
          let newQty = currentQty;
          const updateFields: any = {};

          if (data.category === Category.DRH) {
            const currentRecu = Number(data.qteRecuDRH) || 0;
            const currentSrh = Number(data.qteSrh) || 0;
            const currentSfc = Number(data.qteSfc) || 0;
            if (type === TransactionType.INCOMING) {
              updateFields.qteRecuDRH = currentRecu + amount;
              newQty = Math.max(0, (currentRecu + amount) - (currentSrh + currentSfc));
            } else {
              updateFields.qteRecuDRH = Math.max(0, currentRecu - amount);
              newQty = Math.max(0, Math.max(0, currentRecu - amount) - (currentSrh + currentSfc));
            }
          } else if (data.category === Category.SRH) {
            const currentSrh = Number(data.qteSrh) || 0;
            if (type === TransactionType.INCOMING) {
              updateFields.qteSrh = currentSrh + amount;
              updateFields.qteRecuDRH = currentSrh + amount;
              newQty = currentSrh + amount;
            } else {
              updateFields.qteSrh = Math.max(0, currentSrh - amount);
              updateFields.qteRecuDRH = Math.max(0, currentSrh - amount);
              newQty = Math.max(0, currentSrh - amount);
            }
          } else if (data.category === Category.SFC) {
            const currentSfc = Number(data.qteSfc) || 0;
            if (type === TransactionType.INCOMING) {
              updateFields.qteSfc = currentSfc + amount;
              updateFields.qteRecuDRH = currentSfc + amount;
              newQty = currentSfc + amount;
            } else {
              updateFields.qteSfc = Math.max(0, currentSfc - amount);
              updateFields.qteRecuDRH = Math.max(0, currentSfc - amount);
              newQty = Math.max(0, currentSfc - amount);
            }
          } else {
            newQty = type === TransactionType.INCOMING ? currentQty + amount : currentQty - amount;
          }

          if (newQty < 0) throw new Error("Stock insuffisant !");

          transaction.update(itemRef, {
            ...updateFields,
            quantity: newQty,
            lastUpdated: Date.now(),
          });

          const transRef = doc(collection(db, "transactions"));
          transaction.set(transRef, {
            itemId,
            itemName: itemDoc.data().name,
            type,
            quantity: amount,
            date: Date.now(),
            designationPrestation: designationPrestation,
            observation: observation,
          });
        });
        setIsModalOpen(false);
        return;
      } catch (err) {
        console.warn("Transaction failed, falling back to offline write:", err);
      }
    }

    // Offline or Transaction Failed
    try {
      const currentItem = items.find((i) => i.id === itemId);
      if (!currentItem) throw new Error("Fourniture introuvable !");
      await executeNonTransactional(currentItem);
      showToast("Mouvement enregistré hors-ligne (en attente de synchronisation)");
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Erreur lors de la mise à jour");
    }
  };

  const handleSaveDistribution = async (
    itemId: string,
    qteRecuDRH: number,
    demandeSrh: number,
    demandeSfc: number,
    qteSrh: number,
    qteSfc: number,
    syncStock: boolean,
  ) => {
    const itemRef = doc(db, "items", itemId);

    const executeNonTransactional = async (currentItemData: InventoryItem) => {
      const oldQteRecu = Number(currentItemData.qteRecuDRH) || 0;
      const oldQteSrh = Number(currentItemData.qteSrh) || 0;
      const oldQteSfc = Number(currentItemData.qteSfc) || 0;

      const newQteRecu = Number(qteRecuDRH) || 0;
      const newQteSrh = Number(qteSrh) || 0;
      const newQteSfc = Number(qteSfc) || 0;

      let remainingDistribution = 0;
      if (currentItemData.category === Category.DRH) {
        remainingDistribution = Math.max(0, newQteRecu - (newQteSrh + newQteSfc));
      } else if (currentItemData.category === Category.SRH) {
        remainingDistribution = newQteSrh;
      } else if (currentItemData.category === Category.SFC) {
        remainingDistribution = newQteSfc;
      } else {
        remainingDistribution = Number(currentItemData.quantity) || 0;
      }

      const updateData: any = {
        qteRecuDRH: newQteRecu,
        demandeSrh: Number(demandeSrh) || 0,
        demandeSfc: Number(demandeSfc) || 0,
        qteSrh: newQteSrh,
        qteSfc: newQteSfc,
        lastUpdated: Date.now(),
      };
      if (syncStock) {
        updateData.quantity = remainingDistribution;
      }

      await updateDoc(itemRef, updateData);

      const txsToRecord: any[] = [];

      if (newQteRecu !== oldQteRecu) {
        const diff = Math.abs(newQteRecu - oldQteRecu);
        txsToRecord.push({
          itemId,
          itemName: currentItemData.name || "",
          type: newQteRecu > oldQteRecu ? TransactionType.INCOMING : TransactionType.OUTGOING,
          quantity: diff,
          date: Date.now(),
          designationPrestation: newQteRecu > oldQteRecu 
            ? "Distribution: Réception DRH" 
            : "Distribution: Correction Réception DRH",
          observation: "",
        });
      }

      if (newQteSrh !== oldQteSrh) {
        const diff = Math.abs(newQteSrh - oldQteSrh);
        txsToRecord.push({
          itemId,
          itemName: currentItemData.name || "",
          type: newQteSrh > oldQteSrh ? TransactionType.OUTGOING : TransactionType.INCOMING,
          quantity: diff,
          date: Date.now(),
          designationPrestation: newQteSrh > oldQteSrh 
            ? "Distribution: Dotation SRH" 
            : "Distribution: Correction Dotation SRH",
          observation: "",
        });
      }

      if (newQteSfc !== oldQteSfc) {
        const diff = Math.abs(newQteSfc - oldQteSfc);
        txsToRecord.push({
          itemId,
          itemName: currentItemData.name || "",
          type: newQteSfc > oldQteSfc ? TransactionType.OUTGOING : TransactionType.INCOMING,
          quantity: diff,
          date: Date.now(),
          designationPrestation: newQteSfc > oldQteSfc 
            ? "Distribution: Dotation SFC" 
            : "Distribution: Correction Dotation SFC",
          observation: "",
        });
      }

      for (const tx of txsToRecord) {
        await addDoc(collection(db, "transactions"), tx);
      }
    };

    if (navigator.onLine) {
      try {
        await runTransaction(db, async (transaction) => {
          const itemDoc = await transaction.get(itemRef);
          if (!itemDoc.exists()) throw new Error("Fourniture introuvable !");

          const currentData = itemDoc.data() as InventoryItem;
          const oldQteRecu = Number(currentData.qteRecuDRH) || 0;
          const oldQteSrh = Number(currentData.qteSrh) || 0;
          const oldQteSfc = Number(currentData.qteSfc) || 0;

          const newQteRecu = Number(qteRecuDRH) || 0;
          const newQteSrh = Number(qteSrh) || 0;
          const newQteSfc = Number(qteSfc) || 0;

          let remainingDistribution = 0;
          if (currentData.category === Category.DRH) {
            remainingDistribution = Math.max(0, newQteRecu - (newQteSrh + newQteSfc));
          } else if (currentData.category === Category.SRH) {
            remainingDistribution = newQteSrh;
          } else if (currentData.category === Category.SFC) {
            remainingDistribution = newQteSfc;
          } else {
            remainingDistribution = Number(currentData.quantity) || 0;
          }

          const updateData: any = {
            qteRecuDRH: newQteRecu,
            demandeSrh: Number(demandeSrh) || 0,
            demandeSfc: Number(demandeSfc) || 0,
            qteSrh: newQteSrh,
            qteSfc: newQteSfc,
            lastUpdated: Date.now(),
          };
          if (syncStock) {
            updateData.quantity = remainingDistribution;
          }

          transaction.update(itemRef, updateData);

          // Record transactions for any difference
          const txsToRecord: any[] = [];

          // 1. qteRecuDRH has changed
          if (newQteRecu !== oldQteRecu) {
            const diff = Math.abs(newQteRecu - oldQteRecu);
            txsToRecord.push({
              itemId,
              itemName: currentData.name || "",
              type: newQteRecu > oldQteRecu ? TransactionType.INCOMING : TransactionType.OUTGOING,
              quantity: diff,
              date: Date.now(),
              designationPrestation: newQteRecu > oldQteRecu 
                ? "Distribution: Réception DRH" 
                : "Distribution: Correction Réception DRH",
              observation: "",
            });
          }

          // 2. qteSrh has changed (Dotation SRH)
          if (newQteSrh !== oldQteSrh) {
            const diff = Math.abs(newQteSrh - oldQteSrh);
            txsToRecord.push({
              itemId,
              itemName: currentData.name || "",
              type: newQteSrh > oldQteSrh ? TransactionType.OUTGOING : TransactionType.INCOMING,
              quantity: diff,
              date: Date.now(),
              designationPrestation: newQteSrh > oldQteSrh 
                ? "Distribution: Dotation SRH" 
                : "Distribution: Correction Dotation SRH",
              observation: "",
            });
          }

          // 3. qteSfc has changed (Dotation SFC)
          if (newQteSfc !== oldQteSfc) {
            const diff = Math.abs(newQteSfc - oldQteSfc);
            txsToRecord.push({
              itemId,
              itemName: currentData.name || "",
              type: newQteSfc > oldQteSfc ? TransactionType.OUTGOING : TransactionType.INCOMING,
              quantity: diff,
              date: Date.now(),
              designationPrestation: newQteSfc > oldQteSfc 
                ? "Distribution: Dotation SFC" 
                : "Distribution: Correction Dotation SFC",
              observation: "",
            });
          }

          for (const tx of txsToRecord) {
            const transRef = doc(collection(db, "transactions"));
            transaction.set(transRef, tx);
          }
        });
        return;
      } catch (err) {
        console.warn("Distribution transaction failed, falling back to offline write:", err);
      }
    }

    try {
      const currentItem = items.find((i) => i.id === itemId);
      if (!currentItem) throw new Error("Fourniture introuvable !");
      await executeNonTransactional(currentItem);
      showToast("Distribution enregistrée hors-ligne (mise en attente)");
    } catch (err) {
      console.error("Error saving distribution, fallback to local storage storage:", err);
      // Fallback in case of networking offline issues (just in case writing to offline cache also fails)
      const localDistStr =
        localStorage.getItem("stockpro_distribution_fallback") || "{}";
      const localDistObj = JSON.parse(localDistStr);
      localDistObj[itemId] = {
        qteRecuDRH,
        demandeSrh,
        demandeSfc,
        qteSrh,
        qteSfc,
      };
      localStorage.setItem(
        "stockpro_distribution_fallback",
        JSON.stringify(localDistObj),
      );
    }
  };

  const handleSaveServiceSupply = async (
    itemId: string,
    updatedFields: Partial<InventoryItem>,
  ) => {
    const itemRef = doc(db, "items", itemId);

    const executeNonTransactional = async (currentItemData: InventoryItem) => {
      const nextData = {
        ...currentItemData,
        ...updatedFields,
        lastUpdated: Date.now(),
      };

      // Recalculate remaining stock quantity based on category
      const qteRecuDRH = Number(nextData.qteRecuDRH) || 0;
      const qteSrh = Number(nextData.qteSrh) || 0;
      const qteSfc = Number(nextData.qteSfc) || 0;
      if (nextData.category === Category.DRH) {
        nextData.quantity = Math.max(0, qteRecuDRH - (qteSrh + qteSfc));
      } else if (nextData.category === Category.SRH) {
        nextData.quantity = qteSrh;
      } else if (nextData.category === Category.SFC) {
        nextData.quantity = qteSfc;
      } else {
        nextData.quantity = Number(nextData.quantity) || 0;
      }

      // Calculate differences to record as real-time transactions
      let txDiff = 0;
      let txType = TransactionType.INCOMING;
      let txDesignation = "";

      if (nextData.category === Category.DRH && updatedFields.qteRecuDRH !== undefined) {
        const oldVal = Number(currentItemData.qteRecuDRH) || 0;
        const newVal = Number(updatedFields.qteRecuDRH) || 0;
        if (newVal !== oldVal) {
          txDiff = Math.abs(newVal - oldVal);
          txType = newVal > oldVal ? TransactionType.INCOMING : TransactionType.OUTGOING;
          txDesignation = newVal > oldVal ? "Réception DRH (Remplir)" : "Correction DRH (Remplir)";
        }
      } else if (nextData.category === Category.SRH && updatedFields.qteSrh !== undefined) {
        const oldVal = Number(currentItemData.qteSrh) || 0;
        const newVal = Number(updatedFields.qteSrh) || 0;
        if (newVal !== oldVal) {
          txDiff = Math.abs(newVal - oldVal);
          txType = newVal > oldVal ? TransactionType.INCOMING : TransactionType.OUTGOING;
          txDesignation = newVal > oldVal ? "Réception SRH (Remplir)" : "Correction SRH (Remplir)";
        }
      } else if (nextData.category === Category.SFC && updatedFields.qteSfc !== undefined) {
        const oldVal = Number(currentItemData.qteSfc) || 0;
        const newVal = Number(updatedFields.qteSfc) || 0;
        if (newVal !== oldVal) {
          txDiff = Math.abs(newVal - oldVal);
          txType = newVal > oldVal ? TransactionType.INCOMING : TransactionType.OUTGOING;
          txDesignation = newVal > oldVal ? "Réception SFC (Remplir)" : "Correction SFC (Remplir)";
        }
      }

      await updateDoc(itemRef, nextData);

      if (txDiff > 0) {
        await addDoc(collection(db, "transactions"), {
          itemId,
          itemName: currentItemData.name || "",
          type: txType,
          quantity: txDiff,
          date: Date.now(),
          designationPrestation: txDesignation,
          observation: updatedFields.observation || "",
        });
      }
      setIsModalOpen(false);
    };

    if (navigator.onLine) {
      try {
        await runTransaction(db, async (transaction) => {
          const itemDoc = await transaction.get(itemRef);
          if (!itemDoc.exists()) throw new Error("Item does not exist!");

          const currentData = itemDoc.data() as InventoryItem;
          const nextData = {
            ...currentData,
            ...updatedFields,
            lastUpdated: Date.now(),
          };

          // Recalculate remaining stock quantity based on category
          const qteRecuDRH = Number(nextData.qteRecuDRH) || 0;
          const qteSrh = Number(nextData.qteSrh) || 0;
          const qteSfc = Number(nextData.qteSfc) || 0;
          if (nextData.category === Category.DRH) {
            nextData.quantity = Math.max(0, qteRecuDRH - (qteSrh + qteSfc));
          } else if (nextData.category === Category.SRH) {
            nextData.quantity = qteSrh;
          } else if (nextData.category === Category.SFC) {
            nextData.quantity = qteSfc;
          } else {
            nextData.quantity = Number(nextData.quantity) || 0;
          }

          // Calculate differences to record as real-time transactions
          let txDiff = 0;
          let txType = TransactionType.INCOMING;
          let txDesignation = "";

          if (nextData.category === Category.DRH && updatedFields.qteRecuDRH !== undefined) {
            const oldVal = Number(currentData.qteRecuDRH) || 0;
            const newVal = Number(updatedFields.qteRecuDRH) || 0;
            if (newVal !== oldVal) {
              txDiff = Math.abs(newVal - oldVal);
              txType = newVal > oldVal ? TransactionType.INCOMING : TransactionType.OUTGOING;
              txDesignation = newVal > oldVal ? "Réception DRH (Remplir)" : "Correction DRH (Remplir)";
            }
          } else if (nextData.category === Category.SRH && updatedFields.qteSrh !== undefined) {
            const oldVal = Number(currentData.qteSrh) || 0;
            const newVal = Number(updatedFields.qteSrh) || 0;
            if (newVal !== oldVal) {
              txDiff = Math.abs(newVal - oldVal);
              txType = newVal > oldVal ? TransactionType.INCOMING : TransactionType.OUTGOING;
              txDesignation = newVal > oldVal ? "Réception SRH (Remplir)" : "Correction SRH (Remplir)";
            }
          } else if (nextData.category === Category.SFC && updatedFields.qteSfc !== undefined) {
            const oldVal = Number(currentData.qteSfc) || 0;
            const newVal = Number(updatedFields.qteSfc) || 0;
            if (newVal !== oldVal) {
              txDiff = Math.abs(newVal - oldVal);
              txType = newVal > oldVal ? TransactionType.INCOMING : TransactionType.OUTGOING;
              txDesignation = newVal > oldVal ? "Réception SFC (Remplir)" : "Correction SFC (Remplir)";
            }
          }

          transaction.update(itemRef, nextData);

          if (txDiff > 0) {
            const transRef = doc(collection(db, "transactions"));
            transaction.set(transRef, {
              itemId,
              itemName: currentData.name || "",
              type: txType,
              quantity: txDiff,
              date: Date.now(),
              designationPrestation: txDesignation,
              observation: updatedFields.observation || "",
            });
          }
        });
        setIsModalOpen(false);
        showToast("Fourniture mise à jour avec succès");
        return;
      } catch (err) {
        console.warn("Service supply transaction failed, falling back to offline write:", err);
      }
    }

    try {
      const currentItem = items.find((i) => i.id === itemId);
      if (!currentItem) throw new Error("Article introuvable !");
      await executeNonTransactional(currentItem);
      showToast("Modification enregistrée hors-ligne (synchro auto)");
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Erreur de mise à jour");
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    try {
      await deleteDoc(doc(db, "items", itemId));
      setIsModalOpen(false);
      showToast("Fourniture supprimée avec succès");
    } catch (err) {
      console.error(err);
      showToast("Erreur lors de la suppression de la fourniture");
    }
  };

  const handleCreateSupplyRequest = async (data: {
    itemId: string;
    requestedQuantity: number;
    requesterName: string;
    requesterDepartment: Category;
    observation?: string;
  }) => {
    try {
      const item = items.find((i) => i.id === data.itemId);
      if (!item) throw new Error("Article introuvable");

      await addDoc(collection(db, "supply_requests"), {
        itemId: data.itemId,
        itemName: item.name,
        itemCategory: item.category,
        requestedQuantity: data.requestedQuantity,
        requesterName: data.requesterName,
        requesterDepartment: data.requesterDepartment,
        requestDate: Date.now(),
        status: "PENDING",
        observation: data.observation || "",
      });
      setIsModalOpen(false);
    } catch (err) {
      console.error(err);
      alert(
        err instanceof Error
          ? err.message
          : "Erreur lors du dépôt de la demande",
      );
    }
  };

  const handleValidateSupplyRequest = async (
    requestId: string,
    status: "APPROVED" | "REJECTED",
    validatedQuantity?: number,
    observation?: string,
  ) => {
    const requestRef = doc(db, "supply_requests", requestId);

    const executeNonTransactional = async (
      reqData: SupplyRequest,
      currentItemData: InventoryItem,
    ) => {
      if (status === "APPROVED") {
        const qtyToDeduct =
          validatedQuantity !== undefined
            ? validatedQuantity
            : reqData.requestedQuantity;
        const itemRef = doc(db, "items", reqData.itemId);

        const currentQty = currentItemData.quantity;
        const newQty = currentQty - qtyToDeduct;

        if (newQty < 0)
          throw new Error(
            `Stock insuffisant ! Disponible: ${currentQty} ${currentItemData.unit || "unités"}`,
          );

        // Deduct from stock
        await updateDoc(itemRef, {
          quantity: newQty,
          lastUpdated: Date.now(),
        });

        // Log outgoing transaction
        await addDoc(collection(db, "transactions"), {
          itemId: reqData.itemId,
          itemName: reqData.itemName,
          type: TransactionType.OUTGOING,
          quantity: qtyToDeduct,
          date: Date.now(),
          designationPrestation: `Approbation Demande (${reqData.requesterDepartment}) - ${reqData.requesterName}`,
          observation: observation || reqData.observation || "",
        });

        // Update supply request
        await updateDoc(requestRef, {
          status: "APPROVED",
          validatedQuantity: qtyToDeduct,
          validationDate: Date.now(),
          observation: observation || reqData.observation || "",
        });
      } else {
        // REJECTED
        await updateDoc(requestRef, {
          status: "REJECTED",
          validationDate: Date.now(),
          observation: observation || reqData.observation || "",
        });
      }
      setIsModalOpen(false);
    };

    if (navigator.onLine) {
      try {
        await runTransaction(db, async (tx) => {
          const reqDoc = await tx.get(requestRef);
          if (!reqDoc.exists()) throw new Error("La demande n'existe pas !");

          const reqData = reqDoc.data() as SupplyRequest;
          if (reqData.status !== "PENDING")
            throw new Error("La demande a déjà été traitée.");

          if (status === "APPROVED") {
            const qtyToDeduct =
              validatedQuantity !== undefined
                ? validatedQuantity
                : reqData.requestedQuantity;
            const itemRef = doc(db, "items", reqData.itemId);
            const itemDoc = await tx.get(itemRef);
            if (!itemDoc.exists())
              throw new Error("L'article n'existe pas dans l'inventaire");

            const currentQty = itemDoc.data().quantity;
            const newQty = currentQty - qtyToDeduct;

            if (newQty < 0)
              throw new Error(
                `Stock insuffisant ! Disponible: ${currentQty} ${itemDoc.data().unit || "unités"}`,
              );

            // Deduct from stock
            tx.update(itemRef, {
              quantity: newQty,
              lastUpdated: Date.now(),
            });

            // Log outgoing transaction
            const transRef = doc(collection(db, "transactions"));
            tx.set(transRef, {
              itemId: reqData.itemId,
              itemName: reqData.itemName,
              type: TransactionType.OUTGOING,
              quantity: qtyToDeduct,
              date: Date.now(),
              designationPrestation: `Approbation Demande (${reqData.requesterDepartment}) - ${reqData.requesterName}`,
              observation: observation || reqData.observation || "",
            });

            // Update supply request
            tx.update(requestRef, {
              status: "APPROVED",
              validatedQuantity: qtyToDeduct,
              validationDate: Date.now(),
              observation: observation || reqData.observation || "",
            });
          } else {
            // REJECTED
            tx.update(requestRef, {
              status: "REJECTED",
              validationDate: Date.now(),
              observation: observation || reqData.observation || "",
            });
          }
        });
        setIsModalOpen(false);
        return;
      } catch (err) {
        console.warn("Supply request transaction failed, falling back to offline write:", err);
      }
    }

    try {
      const currentRequest = supplyRequests.find((r) => r.id === requestId);
      if (!currentRequest) throw new Error("Demande introuvable !");
      const currentItem = items.find((i) => i.id === currentRequest.itemId);
      if (!currentItem) throw new Error("Article de l'inventaire introuvable !");
      await executeNonTransactional(currentRequest, currentItem);
      showToast("Demande traitée hors-ligne (synchro en cours)");
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Erreur de traitement");
    }
  };

  if (isLoading || isCheckingPassword) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          className="text-blue-600"
        >
          <Database size={40} />
        </motion.div>
      </div>
    );
  }

  if (isPasscodeConfigured && isLocked) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-800 via-slate-900 to-black">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white p-10 rounded-[2.5rem] w-full max-w-md shadow-2xl border border-slate-100 flex flex-col items-center"
        >
          <div className="h-16 w-16 bg-indigo-50 rounded-3xl flex items-center justify-center text-indigo-600 mb-6 shadow-md shadow-slate-100/50">
            <Lock size={32} />
          </div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight mb-1">StockPro Sécurisé</h2>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 text-center">
            Saisir le code d'accès pour continuer
          </p>
          <div className="w-full">
            <PasswordUnlockForm
              correctPassword={dbPassword}
              onUnlock={() => setIsLocked(false)}
            />
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex font-sans">
      {/* Sidebar */}
      <aside className="w-72 bg-white border-r border-slate-200 p-6 flex flex-col fixed h-full z-30">
        <div className="flex items-center justify-between mb-10 px-2 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 bg-slate-900 rounded-xl flex items-center justify-center text-white shadow-lg">
              <Package size={22} />
            </div>
            <span className="text-xl font-black text-slate-900 tracking-tighter uppercase">
              StockPro
            </span>
          </div>

          <div
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full border transition-all text-[9px] font-black uppercase tracking-widest ${
              isOnline
                ? "bg-emerald-50 border-emerald-100 text-emerald-700"
                : "bg-rose-50 border-rose-100 text-rose-700"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full mr-0.5 ${isOnline ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}`}
            />
            <span>{isOnline ? "En Ligne" : "Hors Ligne"}</span>
          </div>
        </div>

        <nav className="flex-1 space-y-1">
          <SidebarItem
            active={view === "dashboard"}
            onClick={() => setView("dashboard")}
            icon={<LayoutDashboard size={20} />}
            label="Tableau de bord"
          />
          <SidebarItem
            active={view === "inventory"}
            onClick={() => {
              setView("inventory");
              setCategoryFilter("ALL");
            }}
            icon={<ClipboardList size={20} />}
            label="Inventaire"
          />
          <SidebarItem
            active={view === "entrées"}
            onClick={() => {
              setView("entrées");
              setCategoryFilter("ALL");
            }}
            icon={<ArrowDownLeft size={20} />}
            label="Entrées Stock"
          />
          <SidebarItem
            active={view === "sorties"}
            onClick={() => {
              setView("sorties");
              setCategoryFilter("ALL");
            }}
            icon={<ArrowUpRight size={20} />}
            label="Sorties Stock"
          />
          <SidebarItem
            active={view === "drh"}
            onClick={() => {
              setView("drh");
              setCategoryFilter(Category.DRH);
            }}
            icon={<User className="text-amber-500" size={20} />}
            label="Section DRH"
          />
          <SidebarItem
            active={view === "srh"}
            onClick={() => {
              setView("srh");
              setCategoryFilter(Category.SRH);
            }}
            icon={<User className="text-violet-500" size={20} />}
            label="Section SRH"
          />
          <SidebarItem
            active={view === "sfc"}
            onClick={() => {
              setView("sfc");
              setCategoryFilter(Category.SFC);
            }}
            icon={<User className="text-sky-500" size={20} />}
            label="Section SFC"
          />
          <SidebarItem
            active={view === "reste_stock"}
            onClick={() => {
              setView("reste_stock");
              setCategoryFilter("ALL");
            }}
            icon={<ClipboardList className="text-teal-500" size={20} />}
            label="Reste de Stock"
          />
          <SidebarItem
            active={view === "distribution"}
            onClick={() => {
              setView("distribution");
              setCategoryFilter("ALL");
            }}
            icon={<Calculator className="text-pink-500" size={20} />}
            label="Calculateur Distribution"
          />
          <SidebarItem
            active={view === "demandes"}
            onClick={() => {
              setView("demandes");
            }}
            icon={<FileText className="text-indigo-500" size={20} />}
            label="Demande de Fourniture"
          />
          <SidebarItem
            active={view === "history"}
            onClick={() => {
              setView("history");
              setCategoryFilter("ALL");
            }}
            icon={<History size={20} />}
            label="Historique Flux"
          />
          <SidebarItem
            active={view === "rapport_mensuel"}
            onClick={() => {
              setView("rapport_mensuel");
            }}
            icon={<CalendarRange className="text-emerald-500" size={20} />}
            label="Rapport Mensuel"
          />
        </nav>

        <div className="mt-auto pt-6 border-t border-slate-100 space-y-3">
          {/* Lock Screen Settings */}
          <div className="bg-slate-50 p-3 rounded-2xl space-y-2 border border-slate-100">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold text-sm">
                {currentUser?.displayName?.[0] || (currentUser?.email ? currentUser.email[0].toUpperCase() : "A")}
              </div>
              <div className="overflow-hidden flex-1">
                <p className="text-sm font-bold truncate">
                  {currentUser?.displayName || (currentUser?.email ? currentUser.email.split("@")[0] : "Session Invité")}
                </p>
                <p className="text-[9px] text-slate-400 truncate uppercase tracking-widest font-black">
                  Gestion de Stock
                </p>
              </div>
            </div>

            {/* Lock / Config Actions */}
            <div className="grid grid-cols-2 gap-1.5 pt-1.5 border-t border-slate-200/60">
              {isPasscodeConfigured ? (
                <>
                  <button
                    onClick={() => setIsLocked(true)}
                    className="flex items-center justify-center gap-1.5 py-1.5 px-2 bg-slate-900 text-white hover:bg-slate-850 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all"
                    title="Verrouiller l'écran de l'application"
                  >
                    <Lock size={12} /> Verrouiller
                  </button>
                  <button
                    onClick={() => {
                      setModalType("changePassword");
                      setIsModalOpen(true);
                    }}
                    className="flex items-center justify-center gap-1.5 py-1.5 px-2 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all"
                    title="Changer le code d'accès"
                  >
                    Code
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    setModalType("changePassword");
                    setIsModalOpen(true);
                  }}
                  className="col-span-2 flex items-center justify-center gap-1.5 py-2 px-3 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                >
                  <Lock size={12} className="animate-pulse" /> Activer Code d'accès
                </button>
              )}
            </div>
          </div>

          {currentUser ? (
            <button
              onClick={logout}
              className="w-full flex items-center gap-3 p-3 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all font-semibold text-sm"
            >
              <LogOut size={18} /> Déconnexion
            </button>
          ) : (
            <button
              onClick={() => {
                setModalType("auth");
                setIsModalOpen(true);
              }}
              className="w-full flex items-center gap-3 p-3 bg-indigo-550 hover:bg-indigo-600 text-white rounded-xl transition-all font-bold text-sm shadow-md shadow-indigo-100 flex items-center justify-center gap-2"
            >
              <LogIn size={18} /> Se Connecter
            </button>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 ml-72 p-10">
        <header className="flex justify-between items-center mb-10">
          <div>
            <h2 className="text-3xl font-black text-slate-900 capitalize tracking-tight">
              {view === "dashboard" && "Aperçu Global"}
              {view === "inventory" && "Gestion de l'Inventaire"}
              {view === "drh" && "Fournitures DRH"}
              {view === "srh" && "Fournitures SRH"}
              {view === "sfc" && "Fournitures SFC"}
              {view === "reste_stock" && "Reste de Stock"}
              {view === "distribution" &&
                "Distribution & Calculateur de Fournitures"}
              {view === "demandes" && "Demandes de Fournitures"}
              {view === "entrées" && "Registre des Entrées"}
              {view === "sorties" && "Registre des Sorties"}
              {view === "history" && "Flux Entrées / Sorties"}
              {view === "rapport_mensuel" && "Rapport de Distribution Mensuelle"}
            </h2>
            <p className="text-slate-400 font-medium">
              {view === "rapport_mensuel" ? "Récapitulatifs des demandes et dotations par service (DRH, SRH, SFC)." : "Contrôlez vos ressources en temps réel."}
            </p>
          </div>

          <div className="flex gap-3">
            <div className="relative">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300"
                size={18}
              />
              <input
                type="text"
                placeholder="Chercher un produit..."
                className="pl-12 pr-6 py-3 bg-white border border-slate-200 rounded-2xl focus:ring-2 focus:ring-slate-900 outline-none transition-all w-64 shadow-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <button
              onClick={() => {
                setQuickMovementType(TransactionType.INCOMING);
                setModalType("quickMovement");
                setIsModalOpen(true);
              }}
              className="px-6 py-3 bg-emerald-50 text-emerald-600 rounded-2xl font-bold flex items-center gap-2 border border-emerald-100 hover:bg-emerald-100 transition-all active:scale-95"
            >
              <ArrowDownLeft size={18} />
              Entrée
            </button>

            <button
              onClick={() => {
                setQuickMovementType(TransactionType.OUTGOING);
                setModalType("quickMovement");
                setIsModalOpen(true);
              }}
              className="px-6 py-3 bg-rose-50 text-rose-600 rounded-2xl font-bold flex items-center gap-2 border border-rose-100 hover:bg-rose-100 transition-all active:scale-95"
            >
              <ArrowUpRight size={18} />
              Sortie
            </button>

            <button
              onClick={() => {
                setModalType("addItem");
                setIsModalOpen(true);
              }}
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold flex items-center gap-2 shadow-lg active:scale-95 transition-all"
            >
              <Plus size={18} />
              Ajouter un Produit / Fourniture
            </button>

            {view === "demandes" && (
              <button
                onClick={() => {
                  setModalType("createSupplyRequest");
                  setIsModalOpen(true);
                }}
                className="px-6 py-3 bg-indigo-600 text-white rounded-2xl font-bold flex items-center gap-2 shadow-lg hover:bg-indigo-700 active:scale-95 transition-all"
              >
                <Plus size={18} />
                Nouvelle Demande
              </button>
            )}
          </div>
        </header>

        {!isOnline && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-8 p-5 bg-amber-50 rounded-[2rem] border border-amber-100 flex items-center justify-between shadow-sm"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-4 w-4 relative items-center justify-center">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
              </div>
              <div>
                <h4 className="font-bold text-slate-800 text-sm">Mode Hors-ligne Sécurisé Actif</h4>
                <p className="text-slate-500 text-xs font-semibold leading-relaxed mt-0.5">
                  Toutes vos modifications (entrées, sorties, distributions, validations) s'actualisent en temps réel à l'écran et se synchroniseront avec le cloud automatiquement à votre retour en ligne.
                </p>
              </div>
            </div>
            <span className="text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-700 px-3 py-1.5 rounded-xl shrink-0">
              Auto-Synchronisation Activée
            </span>
          </motion.div>
        )}

        <AnimatePresence mode="wait">
          {view === "dashboard" && (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="grid grid-cols-4 gap-6">
                <StatCard
                  color="blue"
                  icon={<Package />}
                  label="Total Références"
                  value={stats.totalItems}
                  subValue="Produits"
                />
                <StatCard
                  color="amber"
                  icon={<AlertTriangle />}
                  label="Stock Faible"
                  value={stats.lowStockItems}
                  subValue="Alertes"
                />
                <StatCard
                  color="rose"
                  icon={<ArrowUpRight />}
                  label="Sorties Aujourd'hui"
                  value={stats.todayActivity}
                  subValue="Mouvements"
                />
                <StatCard
                  color="emerald"
                  icon={<TrendingUp />}
                  label="Disponibilité"
                  value={`${Math.round(((stats.totalItems - stats.outOfStock) / (stats.totalItems || 1)) * 100)}%`}
                />
              </div>

              {/* Banner de Téléchargement du Rapport PDF de Fin de Mois */}
              <div className="bg-gradient-to-r from-emerald-800 to-teal-950 rounded-[2rem] p-8 text-white shadow-md flex flex-col lg:flex-row justify-between items-center gap-6 border border-emerald-700/30">
                <div className="flex items-center gap-5">
                  <div className="h-14 w-14 bg-white/10 rounded-2xl flex items-center justify-center border border-white/10 shadow-inner shrink-0">
                    <CalendarRange className="text-emerald-400 animate-pulse" size={28} />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-lg uppercase tracking-tight text-white">
                      Télécharger la liste sous format PDF (Fin de Mois)
                    </h4>
                    <p className="text-xs text-emerald-300 leading-relaxed font-bold uppercase tracking-wider mt-1">
                      Fiche officielle récapitulative complète pour DRH, SRH, SFC
                    </p>
                    <p className="text-xs text-emerald-100/70 leading-relaxed font-medium mt-1.5">
                      Générez en un clic le rapport de toutes les consommations, des demandes formelles validées et des dotations directes attribuées.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 w-full lg:w-auto">
                  <button
                    onClick={() => setView("rapport_mensuel")}
                    className="flex-1 lg:flex-none px-6 py-3 bg-white/10 hover:bg-white/15 text-white rounded-xl text-xs font-black uppercase tracking-widest transition active:scale-95 border border-white/10 cursor-pointer"
                  >
                    Ouvrir les Détails
                  </button>
                  <button
                    onClick={handlePrint}
                    className="flex-1 lg:flex-none flex items-center justify-center gap-2 px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-black uppercase tracking-widest transition active:scale-95 shadow-lg shadow-emerald-950/20 border border-emerald-400 cursor-pointer text-center"
                  >
                    <Download size={15} /> Télécharger PDF
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-12 gap-8">
                <div className="col-span-8 bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm">
                  <h3 className="text-xl font-bold mb-8 flex items-center gap-2 px-1">
                    Flux Récents
                    <span className="text-[10px] bg-slate-100 px-2 py-1 rounded-md text-slate-500 uppercase tracking-widest font-black">
                      Temps réel
                    </span>
                  </h3>
                  <div className="space-y-4">
                    {transactions.slice(0, 5).map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl hover:bg-white hover:shadow-lg hover:shadow-slate-100 transition-all border border-transparent hover:border-slate-100 group"
                      >
                        <div className="flex items-center gap-4">
                          <div
                            className={`h-12 w-12 rounded-[1.2rem] flex items-center justify-center shadow-sm ${t.type === TransactionType.INCOMING ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}
                          >
                            {t.type === TransactionType.INCOMING ? (
                              <ArrowDownLeft size={20} />
                            ) : (
                              <ArrowUpRight size={20} />
                            )}
                          </div>
                          <div>
                            <p className="font-bold text-slate-900">
                              {t.itemName}
                            </p>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">
                              {t.designationPrestation}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p
                            className={`text-lg font-black ${t.type === TransactionType.INCOMING ? "text-emerald-600" : "text-rose-600"}`}
                          >
                            {t.type === TransactionType.INCOMING ? "+" : "-"}
                            {t.quantity}
                          </p>
                          <p className="text-[10px] text-slate-300 font-bold">
                            {new Date(t.date).toLocaleTimeString("fr-FR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      </div>
                    ))}
                    {transactions.length === 0 && (
                      <p className="text-center py-20 text-slate-300 font-medium italic">
                        Aucun mouvement enregistré
                      </p>
                    )}
                  </div>
                </div>

                <div className="col-span-4 space-y-6">
                  <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white relative overflow-hidden group">
                    <div className="relative z-10 space-y-4">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="text-emerald-400" size={22} />
                        <h4 className="text-lg font-bold">
                          Calculateur Automatique ⚡
                        </h4>
                      </div>
                      <p className="text-slate-400 text-[10px] uppercase tracking-widest font-black">
                        Simulation d'autonomie & de dotations
                      </p>

                      <div className="space-y-4 pt-2">
                        {/* Selector */}
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 font-extrabold uppercase tracking-widest block">
                            Sélectionner l'article
                          </label>
                          <select
                            className="w-full px-3 py-2 bg-white/10 border border-white/5 rounded-xl text-xs font-bold text-white outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                            value={calcItemId}
                            onChange={(e) => setCalcItemId(e.target.value)}
                          >
                            <option
                              value=""
                              className="bg-slate-950 text-slate-400"
                            >
                              Choisir un article...
                            </option>
                            {items.map((item) => (
                              <option
                                key={item.id}
                                value={item.id}
                                className="bg-slate-950 text-white"
                              >
                                {item.name} ({item.quantity} {item.unit})
                              </option>
                            ))}
                          </select>
                        </div>

                        {items.length > 0 && (
                          <>
                            {/* Daily average input */}
                            <div className="space-y-1">
                              <label className="text-[10px] text-slate-400 font-extrabold uppercase tracking-widest block">
                                Consommation journalière estimée
                              </label>
                              <div className="flex items-center gap-2 bg-white/5 rounded-xl p-1 border border-white/5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCalcDailyRate(
                                      Math.max(1, calcDailyRate - 1),
                                    )
                                  }
                                  className="h-8 w-8 bg-white/10 rounded-lg flex items-center justify-center font-bold text-sm hover:bg-white/25 active:scale-95 transition-all"
                                >
                                  -
                                </button>
                                <input
                                  type="number"
                                  className="flex-1 text-center bg-transparent border-none text-xs text-white font-black outline-none"
                                  value={calcDailyRate}
                                  onChange={(e) =>
                                    setCalcDailyRate(
                                      Math.max(1, Number(e.target.value)),
                                    )
                                  }
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCalcDailyRate(calcDailyRate + 1)
                                  }
                                  className="h-8 w-8 bg-white/10 rounded-lg flex items-center justify-center font-bold text-sm hover:bg-white/25 active:scale-95 transition-all"
                                >
                                  +
                                </button>
                              </div>
                            </div>

                            {/* Live calculations display */}
                            {(() => {
                              const activeItem =
                                items.find((i) => i.id === calcItemId) ||
                                items[0];
                              if (!activeItem) return null;

                              const qty = activeItem.quantity || 0;
                              const daysLeft =
                                calcDailyRate > 0
                                  ? Math.floor(qty / calcDailyRate)
                                  : Infinity;
                              const monthlyNeeds = calcDailyRate * 30;
                              const needsReplenish = qty <= activeItem.minStock;
                              const purchaseqty = needsReplenish
                                ? Math.max(0, activeItem.minStock * 2 - qty)
                                : 0;

                              return (
                                <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-3 mt-4 text-xs font-semibold">
                                  <div className="flex justify-between items-center">
                                    <span className="text-slate-450">
                                      Stock Disponible:
                                    </span>
                                    <span className="font-extrabold text-white text-sm">
                                      {qty} {activeItem.unit}
                                    </span>
                                  </div>

                                  <div className="flex justify-between items-center">
                                    <span className="text-slate-450">
                                      Autonomie Estimée:
                                    </span>
                                    <span
                                      className={`font-black text-xs px-2 py-0.5 rounded-lg uppercase tracking-tight ${
                                        daysLeft <= 3
                                          ? "bg-rose-500/20 text-rose-300"
                                          : daysLeft <= 10
                                            ? "bg-amber-500/20 text-amber-300"
                                            : "bg-emerald-500/20 text-emerald-300"
                                      }`}
                                    >
                                      {daysLeft === Infinity
                                        ? "N/A"
                                        : `${daysLeft} Jours`}
                                    </span>
                                  </div>

                                  <div className="flex justify-between items-center">
                                    <span className="text-slate-455">
                                      Prévu pour 30 jours:
                                    </span>
                                    <span className="font-black text-white text-sm">
                                      {monthlyNeeds} {activeItem.unit}
                                    </span>
                                  </div>

                                  <div className="flex justify-between items-center border-t border-white/5 pt-2">
                                    <span className="text-slate-455">
                                      Seuil de Sécurité:
                                    </span>
                                    {needsReplenish ? (
                                      <span className="text-rose-400 font-extrabold flex items-center gap-1">
                                        🚨 Seuil Alerte Atteint
                                      </span>
                                    ) : (
                                      <span className="text-emerald-400 font-extrabold flex items-center gap-1">
                                        ✅ Stock Sécurisé
                                      </span>
                                    )}
                                  </div>

                                  {needsReplenish && purchaseqty > 0 && (
                                    <div className="bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-xl text-[11px] text-rose-200 mt-2">
                                      💡 **Calcul Suggéré:** <br />
                                      Pour retrouver un stock de sécurité
                                      optimal, commandez **{purchaseqty}{" "}
                                      {activeItem.unit}**.
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm">
                    <h4 className="font-bold mb-6 flex items-center gap-2">
                      Alerte Stock Bas
                      <span className="h-2 w-2 bg-amber-500 rounded-full animate-pulse" />
                    </h4>
                    <div className="space-y-4">
                      {items
                        .filter((i) => i.quantity <= i.minStock)
                        .slice(0, 3)
                        .map((i) => (
                          <div
                            key={i.id}
                            className="flex items-center justify-between"
                          >
                            <div className="flex items-center gap-3">
                              <div className="h-2 w-2 bg-amber-400 rounded-full" />
                              <p className="text-sm font-bold text-slate-600">
                                {i.name}
                              </p>
                            </div>
                            <p className="text-xs font-black text-rose-500">
                              {i.quantity} {i.unit}
                            </p>
                          </div>
                        ))}
                      {items.filter((i) => i.quantity <= i.minStock).length ===
                        0 && (
                        <p className="text-xs text-slate-300 italic">
                          Tout est en ordre
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {view === "inventory" && (
            <motion.div
              key="inventory"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              <div className="flex gap-4">
                <select
                  className="px-6 py-3 bg-white border border-slate-100 rounded-2xl font-bold text-slate-600 shadow-sm outline-none focus:ring-2 focus:ring-slate-900 appearance-none min-w-[200px]"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value as any)}
                >
                  <option value="ALL">Toutes catégories</option>
                  {Object.values(Category).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50/50 text-[10px] uppercase tracking-[0.2em] text-slate-400 font-black border-b border-slate-100">
                      <th className="px-8 py-6">Code / Désignation</th>
                      <th className="px-8 py-6">Emplacement</th>
                      <th className="px-8 py-6">Catégorie</th>
                      <th className="px-8 py-6">Quantité</th>
                      <th className="px-8 py-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredItems.map((item) => (
                      <tr
                        key={item.id}
                        className="group hover:bg-slate-50/30 transition-all duration-200"
                      >
                        <td className="px-8 py-6">
                          <div className="flex items-center gap-4">
                            <div className="h-10 w-10 bg-slate-100 rounded-xl flex items-center justify-center text-slate-400 font-bold text-xs group-hover:bg-slate-900 group-hover:text-white transition-all">
                              {item.category[0]}
                            </div>
                            <div>
                              <p className="font-bold text-slate-900">
                                {item.name}
                              </p>
                              <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">
                                {item.nProduit}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-8 py-6 text-xs font-bold text-slate-400">
                          {item.location || "-"}
                        </td>
                        <td className="px-8 py-6">
                          <span className="text-[10px] font-black uppercase tracking-widest px-3 py-1 bg-slate-100 text-slate-500 rounded-lg">
                            {item.category}
                          </span>
                        </td>
                        <td className="px-8 py-6 font-bold text-slate-700">
                          {getItemRemainingStock(item)}{" "}
                          <span className="text-[10px] text-slate-300">
                            {item.unit}
                          </span>
                        </td>
                        <td className="px-8 py-6 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => {
                                setSelectedItem(item);
                                setModalType("updateStock");
                                setIsModalOpen(true);
                              }}
                              className="p-2.5 bg-slate-50 text-slate-400 hover:text-slate-900 hover:bg-white hover:shadow-xl hover:shadow-slate-200/50 rounded-xl transition-all"
                            >
                              <ArrowRightLeft size={18} />
                            </button>
                            <button
                              onClick={() => {
                                setSelectedItem(item);
                                setModalType("deleteItem");
                                setIsModalOpen(true);
                              }}
                              className="p-2.5 bg-rose-50 text-rose-500 hover:text-white hover:bg-rose-600 hover:shadow-xl hover:shadow-rose-200/50 rounded-xl transition-all"
                              title="Supprimer"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {view === "drh" && (
            <motion.div
              key="drh"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-900 p-6 rounded-[2rem] text-white">
                <div className="flex items-center gap-4">
                  <User className="text-amber-400" size={32} />
                  <div>
                    <h4 className="font-bold text-xl uppercase tracking-tighter">
                      Registre Spécial DRH
                    </h4>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">
                      Suivi des prestations et dotations
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      setCategoryFilter(Category.DRH);
                      setModalType("addItem");
                      setIsModalOpen(true);
                    }}
                    className="px-4 py-3 bg-white/10 hover:bg-white/20 rounded-2xl text-[11px] font-black uppercase tracking-wider transition-all border border-white/10"
                  >
                    ➕ Créer Fourniture DRH
                  </button>
                  <button
                    onClick={() => {
                      setCategoryFilter(Category.DRH);
                      setQuickMovementType(TransactionType.INCOMING);
                      setModalType("quickMovement");
                      setIsModalOpen(true);
                    }}
                    className="px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-[11px] font-black uppercase tracking-wider transition-all shadow-md"
                  >
                    📥 Entrée Stock (DRH)
                  </button>
                  <button
                    onClick={() => {
                      setCategoryFilter(Category.DRH);
                      setQuickMovementType(TransactionType.OUTGOING);
                      setModalType("quickMovement");
                      setIsModalOpen(true);
                    }}
                    className="px-4 py-3 bg-rose-600 hover:bg-rose-500 text-white rounded-2xl text-[11px] font-black uppercase tracking-wider transition-all shadow-md"
                  >
                    📤 Sortie Stock (DRH)
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden animate-fade-in">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <div>
                    <h5 className="font-black text-base text-slate-900 uppercase tracking-tight">
                      💼 Tableau des Fournitures DRH
                    </h5>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                      Suivi en temps réel des fournitures de la DRH
                    </p>
                  </div>
                </div>
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50/50 text-[10px] uppercase tracking-[0.2em] text-slate-400 font-black border-b border-slate-100">
                      <th className="px-8 py-6">Désignation des prestations</th>
                      <th className="px-8 py-6 text-center">Quantité Demandée</th>
                      <th className="px-8 py-6 text-center">Date</th>
                      <th className="px-8 py-6 text-center">Quantité Reçu</th>
                      <th className="px-8 py-6 text-center">En Date</th>
                      <th className="px-8 py-6">Observation</th>
                      <th className="px-8 py-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {items
                      .filter((item) => {
                        const matchesSearch =
                          item.name
                            .toLowerCase()
                            .includes(searchQuery.toLowerCase()) ||
                          item.nProduit
                            .toLowerCase()
                            .includes(searchQuery.toLowerCase());
                        const matchesCategory = item.category === Category.DRH;
                        return matchesSearch && matchesCategory;
                      })
                      .map((item) => (
                        <tr
                          key={item.id}
                          className="hover:bg-slate-50/10 transition-all duration-200"
                        >
                          <td className="px-8 py-6">
                            <div className="flex flex-col">
                              <span className="font-extrabold text-slate-900 text-base">
                                {item.name}
                              </span>
                              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">
                                {item.nProduit}
                              </span>
                            </div>
                          </td>
                          <td className="px-8 py-6 text-center font-black">
                            <div className="flex flex-col">
                              <span className="text-rose-600 text-base">
                                {(item.demandeSrh || 0) +
                                  (item.demandeSfc || 0)}
                              </span>
                              <span className="text-[9px] text-slate-400 font-bold uppercase mt-0.5">
                                SRH: {item.demandeSrh || 0} | SFC:{" "}
                                {item.demandeSfc || 0}
                              </span>
                            </div>
                          </td>
                          <td className="px-8 py-6 text-center text-xs font-bold text-slate-500">
                            {item.lastUpdated
                              ? new Date(item.lastUpdated).toLocaleDateString(
                                  "fr-FR",
                                )
                              : "-"}
                          </td>
                          <td className="px-8 py-6 text-center font-black text-emerald-600 text-base">
                            {item.qteRecuDRH || 0}
                          </td>
                          <td className="px-8 py-6 text-center text-xs font-bold text-slate-500">
                            {item.lastUpdated
                              ? new Date(item.lastUpdated).toLocaleDateString(
                                  "fr-FR",
                                )
                              : "-"}
                          </td>
                          <td className="px-8 py-6 text-xs text-slate-500 italic max-w-xs truncate" title={item.observation}>
                            {item.observation || "-"}
                          </td>
                          <td className="px-8 py-6 text-right">
                            <div className="flex justify-end gap-2">
                              <button
                              onClick={() => {
                                setSelectedItem(item);
                                setModalType("editServiceSupply");
                                setIsModalOpen(true);
                              }}
                              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-extrabold rounded-xl text-xs uppercase tracking-wider transition-all inline-flex items-center gap-1.5"
                            >
                              ✏️ Remplir
                            </button>
                            <button
                              onClick={() => {
                                setSelectedItem(item);
                                setModalType("deleteItem");
                                setIsModalOpen(true);
                              }}
                              className="p-2 bg-rose-50 text-rose-500 hover:text-white hover:bg-rose-600 rounded-xl transition-all"
                              title="Supprimer"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  {items.filter((item) => item.category === Category.DRH)
                      .length === 0 && (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-8 py-20 text-center text-slate-300 font-medium italic"
                        >
                          Aucune fourniture DRH enregistrée
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {view === "srh" && (
            <motion.div
              key="srh"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 rounded-[2rem] text-white">
                <div className="flex items-center gap-4">
                  <User className="text-violet-400" size={32} />
                  <div>
                    <h4 className="font-bold text-xl uppercase tracking-tighter">
                      Registre Spécial SRH
                    </h4>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">
                      Suivi des prestations et dotations SRH
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      setCategoryFilter(Category.SRH);
                      setModalType("addItem");
                      setIsModalOpen(true);
                    }}
                    className="px-4 py-3 bg-white/10 hover:bg-white/20 rounded-2xl text-[11px] font-black uppercase tracking-wider transition-all border border-white/10"
                  >
                    ➕ Créer Fourniture SRH
                  </button>
                  <button
                    onClick={() => {
                      setCategoryFilter(Category.SRH);
                      setQuickMovementType(TransactionType.INCOMING);
                      setModalType("quickMovement");
                      setIsModalOpen(true);
                    }}
                    className="px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-[11px] font-black uppercase tracking-wider transition-all shadow-md"
                  >
                    📥 Entrée Stock (SRH)
                  </button>
                  <button
                    onClick={() => {
                      setCategoryFilter(Category.SRH);
                      setQuickMovementType(TransactionType.OUTGOING);
                      setModalType("quickMovement");
                      setIsModalOpen(true);
                    }}
                    className="px-4 py-3 bg-rose-600 hover:bg-rose-500 text-white rounded-2xl text-[11px] font-black uppercase tracking-wider transition-all shadow-md"
                  >
                    📤 Sortie Stock (SRH)
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden animate-fade-in">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <div>
                    <h5 className="font-black text-base text-slate-900 uppercase tracking-tight">
                      💼 Tableau des Fournitures SRH
                    </h5>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                      Suivi en temps réel des fournitures de la SRH
                    </p>
                  </div>
                </div>
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50/50 text-[10px] uppercase tracking-[0.2em] text-slate-400 font-black border-b border-slate-100">
                      <th className="px-8 py-6">Désignation des prestations</th>
                      <th className="px-8 py-6 text-center">Quantité Demandée</th>
                      <th className="px-8 py-6 text-center">Date</th>
                      <th className="px-8 py-6 text-center">Quantité Reçu</th>
                      <th className="px-8 py-6 text-center">En Date</th>
                      <th className="px-8 py-6">Observation</th>
                      <th className="px-8 py-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {items
                      .filter((item) => {
                        const matchesSearch =
                          item.name
                            .toLowerCase()
                            .includes(searchQuery.toLowerCase()) ||
                          item.nProduit
                            .toLowerCase()
                            .includes(searchQuery.toLowerCase());
                        const matchesCategory = item.category === Category.SRH;
                        return matchesSearch && matchesCategory;
                      })
                      .map((item) => (
                        <tr
                          key={item.id}
                          className="hover:bg-slate-50/10 transition-all duration-200"
                        >
                          <td className="px-8 py-6">
                            <div className="flex flex-col">
                              <span className="font-extrabold text-slate-900 text-base">
                                {item.name}
                              </span>
                              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">
                                {item.nProduit}
                              </span>
                            </div>
                          </td>
                          <td className="px-8 py-6 text-center font-black text-rose-600 text-base">
                            {item.demandeSrh || 0}
                          </td>
                          <td className="px-8 py-6 text-center text-xs font-bold text-slate-500">
                            {item.lastUpdated
                              ? new Date(item.lastUpdated).toLocaleDateString(
                                  "fr-FR",
                                )
                              : "-"}
                          </td>
                          <td className="px-8 py-6 text-center font-black text-emerald-600 text-base">
                            {item.qteSrh || 0}
                          </td>
                          <td className="px-8 py-6 text-center text-xs font-bold text-slate-500">
                            {item.lastUpdated
                              ? new Date(item.lastUpdated).toLocaleDateString(
                                  "fr-FR",
                                )
                              : "-"}
                          </td>
                          <td className="px-8 py-6 text-xs text-slate-500 italic max-w-xs truncate" title={item.observation}>
                            {item.observation || "-"}
                          </td>
                          <td className="px-8 py-6 text-right">
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => {
                                  setSelectedItem(item);
                                  setModalType("editServiceSupply");
                                  setIsModalOpen(true);
                                }}
                                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-extrabold rounded-xl text-xs uppercase tracking-wider transition-all inline-flex items-center gap-1.5"
                              >
                                ✏️ Remplir
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedItem(item);
                                  setModalType("deleteItem");
                                  setIsModalOpen(true);
                                }}
                                className="p-2.5 bg-rose-50 text-rose-500 hover:text-white hover:bg-rose-600 hover:shadow-xl hover:shadow-rose-200/50 rounded-xl transition-all"
                                title="Supprimer"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    {items.filter((item) => item.category === Category.SRH)
                      .length === 0 && (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-8 py-20 text-center text-slate-300 font-medium italic"
                        >
                          Aucune fourniture SRH enregistrée
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {view === "sfc" && (
            <motion.div
              key="sfc"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-950 p-6 rounded-[2rem] text-white">
                <div className="flex items-center gap-4">
                  <User className="text-sky-400" size={32} />
                  <div>
                    <h4 className="font-bold text-xl uppercase tracking-tighter">
                      Registre Spécial SFC
                    </h4>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">
                      Suivi des prestations et dotations SFC
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      setCategoryFilter(Category.SFC);
                      setModalType("addItem");
                      setIsModalOpen(true);
                    }}
                    className="px-4 py-3 bg-white/10 hover:bg-white/20 rounded-2xl text-[11px] font-black uppercase tracking-wider transition-all border border-white/10"
                  >
                    ➕ Créer Fourniture SFC
                  </button>
                  <button
                    onClick={() => {
                      setCategoryFilter(Category.SFC);
                      setQuickMovementType(TransactionType.INCOMING);
                      setModalType("quickMovement");
                      setIsModalOpen(true);
                    }}
                    className="px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-[11px] font-black uppercase tracking-wider transition-all shadow-md"
                  >
                    📥 Entrée Stock (SFC)
                  </button>
                  <button
                    onClick={() => {
                      setCategoryFilter(Category.SFC);
                      setQuickMovementType(TransactionType.OUTGOING);
                      setModalType("quickMovement");
                      setIsModalOpen(true);
                    }}
                    className="px-4 py-3 bg-rose-600 hover:bg-rose-500 text-white rounded-2xl text-[11px] font-black uppercase tracking-wider transition-all shadow-md"
                  >
                    📤 Sortie Stock (SFC)
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden animate-fade-in">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <div>
                    <h5 className="font-black text-base text-slate-900 uppercase tracking-tight">
                      💼 Tableau des Fournitures SFC
                    </h5>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                      Suivi en temps réel des fournitures de la SFC
                    </p>
                  </div>
                </div>
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50/50 text-[10px] uppercase tracking-[0.2em] text-slate-400 font-black border-b border-slate-100">
                      <th className="px-8 py-6">Désignation des prestations</th>
                      <th className="px-8 py-6 text-center">Quantité Demandée</th>
                      <th className="px-8 py-6 text-center">Date</th>
                      <th className="px-8 py-6 text-center">Quantité Reçu</th>
                      <th className="px-8 py-6 text-center">En Date</th>
                      <th className="px-8 py-6">Observation</th>
                      <th className="px-8 py-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {items
                      .filter((item) => {
                        const matchesSearch =
                          item.name
                            .toLowerCase()
                            .includes(searchQuery.toLowerCase()) ||
                          item.nProduit
                            .toLowerCase()
                            .includes(searchQuery.toLowerCase());
                        const matchesCategory = item.category === Category.SFC;
                        return matchesSearch && matchesCategory;
                      })
                      .map((item) => (
                        <tr
                          key={item.id}
                          className="hover:bg-slate-50/10 transition-all duration-200"
                        >
                          <td className="px-8 py-6">
                            <div className="flex flex-col">
                              <span className="font-extrabold text-slate-900 text-base">
                                {item.name}
                              </span>
                              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">
                                {item.nProduit}
                              </span>
                            </div>
                          </td>
                          <td className="px-8 py-6 text-center font-black text-rose-600 text-base">
                            {item.demandeSfc || 0}
                          </td>
                          <td className="px-8 py-6 text-center text-xs font-bold text-slate-500">
                            {item.lastUpdated
                              ? new Date(item.lastUpdated).toLocaleDateString(
                                  "fr-FR",
                                )
                              : "-"}
                          </td>
                          <td className="px-8 py-6 text-center font-black text-emerald-600 text-base">
                            {item.qteSfc || 0}
                          </td>
                          <td className="px-8 py-6 text-center text-xs font-bold text-slate-500">
                            {item.lastUpdated
                              ? new Date(item.lastUpdated).toLocaleDateString(
                                  "fr-FR",
                                )
                              : "-"}
                          </td>
                          <td className="px-8 py-6 text-xs text-slate-500 italic max-w-xs truncate" title={item.observation}>
                            {item.observation || "-"}
                          </td>
                          <td className="px-8 py-6 text-right">
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => {
                                  setSelectedItem(item);
                                  setModalType("editServiceSupply");
                                  setIsModalOpen(true);
                                }}
                                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-extrabold rounded-xl text-xs uppercase tracking-wider transition-all inline-flex items-center gap-1.5"
                              >
                                ✏️ Remplir
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedItem(item);
                                  setModalType("deleteItem");
                                  setIsModalOpen(true);
                                }}
                                className="p-2.5 bg-rose-50 text-rose-500 hover:text-white hover:bg-rose-600 hover:shadow-xl hover:shadow-rose-200/50 rounded-xl transition-all"
                                title="Supprimer"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    {items.filter((item) => item.category === Category.SFC)
                      .length === 0 && (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-8 py-20 text-center text-slate-300 font-medium italic"
                        >
                          Aucune fourniture SFC enregistrée
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {view === "reste_stock" && (
            <motion.div
              key="reste"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              <div className="flex justify-between items-center bg-gradient-to-r from-teal-900 via-emerald-950 to-teal-900 p-6 rounded-[2rem] text-white">
                <div className="flex items-center gap-4">
                  <ClipboardList className="text-teal-400" size={32} />
                  <div>
                    <h4 className="font-bold text-xl uppercase tracking-tighter text-teal-100">
                      Fiche de Reste de Stock
                    </h4>
                    <p className="text-xs text-teal-300 font-bold uppercase tracking-widest mt-0.5">
                      État réel du stock restant avec dates d'ajustement
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <select
                    className="px-4 py-2 bg-white/10 border border-white/10 rounded-xl text-xs font-black uppercase text-white tracking-wider outline-none focus:ring-2 focus:ring-teal-500 appearance-none min-w-[200px] cursor-pointer font-bold"
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value as any)}
                  >
                    <option
                      value="ALL"
                      className="bg-teal-950 text-white font-bold"
                    >
                      Tous les services / catégories
                    </option>
                    {Object.values(Category).map((c) => (
                      <option
                        key={c}
                        value={c}
                        className="bg-teal-950 text-white font-bold"
                      >
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden text-slate-800 animate-fade-in">
                <table className="w-full text-left font-sans">
                  <thead>
                    <tr className="bg-slate-50/50 text-[10px] uppercase tracking-[0.2em] text-slate-400 font-black border-b border-slate-100">
                      <th className="px-8 py-6">Désignation des prestations</th>
                      <th className="px-8 py-6 text-center">Reste de Stock</th>
                      <th className="px-8 py-6 text-center">En Date</th>
                      <th className="px-8 py-6">Catégorie / Service</th>
                      <th className="px-8 py-6">Code / Réf</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {items
                      .filter((item) => {
                        const matchesSearch =
                          item.name
                            .toLowerCase()
                            .includes(searchQuery.toLowerCase()) ||
                          item.nProduit
                            .toLowerCase()
                            .includes(searchQuery.toLowerCase());
                        const matchesCategory =
                          categoryFilter === "ALL" ||
                          item.category === categoryFilter;
                        return matchesSearch && matchesCategory;
                      })
                      .map((item) => {
                        const remainingStock = getItemRemainingStock(item);
                        const isLowStock = remainingStock <= item.minStock;
                        return (
                          <tr
                            key={item.id}
                            className="hover:bg-slate-50/30 transition-all duration-200"
                          >
                            <td className="px-8 py-6">
                              <div className="flex flex-col">
                                <span className="font-bold text-slate-900 text-base">
                                  {item.name}
                                </span>
                                <div
                                  className="flex gap-2 flex-wrap items-center mt-1.5 text-[10px]"
                                  style={{ color: "#000000" }}
                                >
                                  {item.qteRecuDRH !== undefined && (
                                    <span className="bg-amber-50 text-amber-900 px-1.5 py-0.5 rounded border border-amber-250 font-bold">
                                      Arrivé DRH:{" "}
                                      <span className="font-black text-xs">
                                        {item.qteRecuDRH}
                                      </span>
                                    </span>
                                  )}
                                  {item.demandeSrh !== undefined &&
                                    item.demandeSrh > 0 && (
                                      <span className="bg-purple-50 text-purple-900 px-1.5 py-0.5 rounded border border-purple-250 font-bold">
                                        Demande SRH:{" "}
                                        <span className="font-black text-xs">
                                          {item.demandeSrh}
                                        </span>
                                      </span>
                                    )}
                                  {item.demandeSfc !== undefined &&
                                    item.demandeSfc > 0 && (
                                      <span className="bg-sky-50 text-sky-900 px-1.5 py-0.5 rounded border border-sky-250 font-bold">
                                        Demande SFC:{" "}
                                        <span className="font-black text-xs">
                                          {item.demandeSfc}
                                        </span>
                                      </span>
                                    )}
                                  {item.qteSrh !== undefined &&
                                    item.qteSrh > 0 && (
                                      <span className="bg-violet-50 text-violet-900 px-1.5 py-0.5 rounded border border-violet-200 font-bold">
                                        Donné SRH:{" "}
                                        <span className="font-black text-xs">
                                          {item.qteSrh}
                                        </span>
                                      </span>
                                    )}
                                  {item.qteSfc !== undefined &&
                                    item.qteSfc > 0 && (
                                      <span className="bg-emerald-50 text-emerald-900 px-1.5 py-0.5 rounded border border-emerald-200 font-bold">
                                        Donné SFC:{" "}
                                        <span className="font-black text-xs">
                                          {item.qteSfc}
                                        </span>
                                      </span>
                                    )}
                                  {item.demandeSrh !== undefined &&
                                    item.qteSrh !== undefined &&
                                    item.demandeSrh > item.qteSrh && (
                                      <span className="bg-rose-50 text-rose-900 px-1.5 py-0.5 rounded border border-rose-250 font-bold">
                                        Reste à livrer SRH:{" "}
                                        <span className="font-black text-xs text-rose-700">
                                          -{item.demandeSrh - item.qteSrh}
                                        </span>
                                      </span>
                                    )}
                                  {item.demandeSfc !== undefined &&
                                    item.qteSfc !== undefined &&
                                    item.demandeSfc > item.qteSfc && (
                                      <span className="bg-rose-50 text-rose-900 px-1.5 py-0.5 rounded border border-rose-250 font-bold font-mono font-bold">
                                        Reste à livrer SFC:{" "}
                                        <span className="font-black text-xs text-rose-700 font-bold">
                                          -{item.demandeSfc - item.qteSfc}
                                        </span>
                                      </span>
                                    )}
                                </div>
                                {item.location && (
                                  <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-tight mt-0.5">
                                    Emplacement: {item.location}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-8 py-6 text-center">
                              <span
                                className={`inline-flex items-center justify-center font-black text-base px-4 py-2 rounded-2xl ${
                                  remainingStock === 0
                                    ? "bg-rose-50 text-rose-600"
                                    : isLowStock
                                      ? "bg-amber-50 text-amber-600"
                                      : "bg-emerald-50 text-emerald-600"
                                }`}
                              >
                                {remainingStock}{" "}
                                <span className="text-[10px] font-bold uppercase tracking-widest opacity-80 pl-1.5">
                                  {item.unit}
                                </span>
                              </span>
                            </td>
                            <td className="px-8 py-6 text-center text-sm font-semibold text-slate-500">
                              {item.lastUpdated
                                ? new Date(item.lastUpdated).toLocaleDateString(
                                    "fr-FR",
                                    {
                                      day: "2-digit",
                                      month: "2-digit",
                                      year: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    },
                                  )
                                : "-"}
                            </td>
                            <td className="px-8 py-6">
                              <span className="text-[10px] font-black uppercase tracking-widest px-3 py-1 bg-slate-100 text-slate-600 rounded-lg">
                                {item.category}
                              </span>
                            </td>
                            <td className="px-8 py-6 font-bold text-slate-400 tracking-widest uppercase text-xs">
                              {item.nProduit}
                            </td>
                          </tr>
                        );
                      })}
                    {items.filter((item) => {
                      const matchesSearch =
                        item.name
                          .toLowerCase()
                          .includes(searchQuery.toLowerCase()) ||
                        item.nProduit
                          .toLowerCase()
                          .includes(searchQuery.toLowerCase());
                      const matchesCategory =
                        categoryFilter === "ALL" ||
                        item.category === categoryFilter;
                      return matchesSearch && matchesCategory;
                    }).length === 0 && (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-8 py-20 text-center text-slate-300 font-medium italic"
                        >
                          Aucun article trouvé
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {view === "distribution" &&
            (() => {
              const filteredDistItems = items.filter((item) => {
                const matchesSearch =
                  item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  item.nProduit
                    .toLowerCase()
                    .includes(searchQuery.toLowerCase());
                const matchesCategory =
                  categoryFilter === "ALL" || item.category === categoryFilter;
                return matchesSearch && matchesCategory;
              });

              const activeItem =
                filteredDistItems.find((it) => it.id === activeDistItemId) ||
                filteredDistItems[0] ||
                null;

              return (
                <motion.div
                  key="distribution"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="space-y-6 animate-fade-in text-black"
                >
                  {/* Top Card banner */}
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-950 p-6 rounded-[2rem] text-white">
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 bg-pink-500 rounded-2xl flex items-center justify-center text-white shadow-lg shrink-0">
                        <Calculator size={24} />
                      </div>
                      <div>
                        <h4 className="font-bold text-xl uppercase tracking-tighter text-white">
                          Calculateur Automatique de Distribution
                        </h4>
                        <p className="text-xs text-slate-300 font-bold uppercase tracking-widest mt-0.5">
                          Saisissez l'arrivée DRH et les demandes de SRH & SFC
                          pour gérer automatiquement les attributions, manques
                          et stocks restants.
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <select
                        className="px-4 py-2 bg-white/10 border border-white/10 rounded-xl text-xs font-black uppercase text-white tracking-wider outline-none focus:ring-2 focus:ring-pink-500 appearance-none min-w-[200px] cursor-pointer font-bold"
                        value={categoryFilter}
                        onChange={(e) =>
                          setCategoryFilter(e.target.value as any)
                        }
                      >
                        <option
                          value="ALL"
                          className="bg-slate-900 text-white font-bold"
                        >
                          Toutes les catégories
                        </option>
                        {Object.values(Category).map((c) => (
                          <option
                            key={c}
                            value={c}
                            className="bg-slate-900 text-white font-bold"
                          >
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Instructions on how it calculates */}
                  <div className="bg-amber-50 border border-amber-200 p-5 rounded-2xl flex items-start gap-3 text-black text-xs font-semibold">
                    <span className="p-1 px-2.5 bg-amber-200 rounded-lg text-amber-800 font-black">
                      RÈGLE DE CALCUL
                    </span>
                    <div>
                      <p className="font-bold text-sm text-slate-900">
                        Calcul automatique et gestion des livraisons (En Darija)
                        :
                      </p>
                      <ul
                        className="list-disc list-inside mt-2 space-y-1 text-slate-800 font-semibold"
                        style={{ color: "#000000" }}
                      >
                        <li>
                          <strong className="text-slate-950 font-black">
                            Arrivé DRH (CHHL JA)
                          </strong>
                          : Quantité reçue à la DRH (ex: 10).
                        </li>
                        <li>
                          <strong className="text-slate-950 font-black">
                            Demandes SRH / SFC
                          </strong>
                          : Ce qu'ils ont demandé à la DRH (ex: SRH = 7, SFC =
                          7; Total = 14).
                        </li>
                        <li>
                          <strong className="text-slate-950 font-black">
                            Donné Réel (Livré)
                          </strong>
                          : C'est ce qui est réellement livré. C'est calculé
                          automatiquement pour donner le maximum possible de ce
                          qui est disponible, mais vous pouvez aussi ajuster les
                          chiffres manuellement.
                        </li>
                        <li>
                          <strong className="text-slate-950 font-black">
                            Le Manque (Na9s)
                          </strong>
                          : S'il n'y a pas assez (ex: 10 au lieu de 14), le
                          reste à livrer est calculé automatiquement (ex: -2
                          pour SRH et -2 pour SFC). DRH donnera la différence
                          dès qu'une nouvelle commande arrivera.
                        </li>
                        <li>
                          <strong className="text-slate-950 font-black">
                            Reste en stock DRH (Le Reste)
                          </strong>
                          : Calculé automatiquement :{" "}
                          <code>Arrivé DRH - (Donné SRH + Donné SFC)</code> (ex:
                          10 - 7 - 3 = 0, ou s'ils ont demandé 2 et 3: 10 - 5 =
                          5 restant).
                        </li>
                      </ul>
                    </div>
                  </div>

                  {/* Active split content */}
                  <div className="grid grid-cols-12 gap-6 items-start">
                    {/* Left block (col-span-8): Interactive table */}
                    <div className="col-span-12 xl:col-span-8 bg-white rounded-[2.5rem] border border-slate-150 shadow-sm overflow-hidden text-black font-sans">
                      <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                        <div>
                          <h5 className="font-extrabold text-sm text-slate-900 uppercase tracking-wider">
                            📦 Liste des fournitures & stocks
                          </h5>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                            Cliquez sur un produit pour voir son schéma visuel
                          </p>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="bg-slate-50 text-[10px] uppercase tracking-wider text-black font-black border-b border-slate-200">
                              <th className="px-6 py-5">
                                Désignation de la Fourniture
                              </th>
                              <th className="px-4 py-5 text-center bg-amber-50/50">
                                1. Reçu DRH (CHHL JA)
                              </th>
                              <th className="px-4 py-5 text-center bg-violet-50/50">
                                2. Demandes (Bghaw)
                              </th>
                              <th className="px-4 py-5 text-center bg-emerald-50/50">
                                3. Livraisons (Donné)
                              </th>
                              <th className="px-4 py-5 text-center bg-rose-50/50">
                                Manque (Na9s)
                              </th>
                              <th className="px-4 py-5 text-center bg-slate-150">
                                Reste de Stock DRH
                              </th>
                              <th className="px-6 py-5 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody
                            className="divide-y divide-slate-150 font-bold text-black"
                            style={{ color: "#000000" }}
                          >
                            {filteredDistItems.map((item) => {
                              // Draft state values
                              const draft = distributionDrafts[item.id] || {
                                qteRecuDRH: item.qteRecuDRH || 0,
                                demandeSrh: item.demandeSrh || 0,
                                demandeSfc: item.demandeSfc || 0,
                                qteSrh: item.qteSrh || 0,
                                qteSfc: item.qteSfc || 0,
                                syncStock: true,
                              };

                              const totalGiven = draft.qteSrh + draft.qteSfc;
                              const remainingStockDRH = Math.max(
                                0,
                                draft.qteRecuDRH - totalGiven,
                              );
                              const srhShortage = Math.max(
                                0,
                                draft.demandeSrh - draft.qteSrh,
                              );
                              const sfcShortage = Math.max(
                                0,
                                draft.demandeSfc - draft.qteSfc,
                              );

                              const updateDraft = (
                                newFields: Partial<typeof draft>,
                              ) => {
                                const newDraft = { ...draft, ...newFields };

                                // Realtime auto-calculate distribution whenever Recu or Demande is changed by user
                                if (
                                  "qteRecuDRH" in newFields ||
                                  "demandeSrh" in newFields ||
                                  "demandeSfc" in newFields
                                ) {
                                  const totalDemand =
                                    newDraft.demandeSrh + newDraft.demandeSfc;
                                  if (totalDemand <= newDraft.qteRecuDRH) {
                                    newDraft.qteSrh = newDraft.demandeSrh;
                                    newDraft.qteSfc = newDraft.demandeSfc;
                                  } else {
                                    if (totalDemand > 0) {
                                      // Balanced proportional split as default suggested allocation
                                      let compSrh = Math.round(
                                        (newDraft.demandeSrh / totalDemand) *
                                          newDraft.qteRecuDRH,
                                      );
                                      let compSfc = Math.max(
                                        0,
                                        newDraft.qteRecuDRH - compSrh,
                                      );

                                      if (compSfc > newDraft.demandeSfc) {
                                        compSfc = newDraft.demandeSfc;
                                        compSrh = Math.max(
                                          0,
                                          newDraft.qteRecuDRH - compSfc,
                                        );
                                      }
                                      if (compSrh > newDraft.demandeSrh) {
                                        compSrh = newDraft.demandeSrh;
                                        compSfc = Math.max(
                                          0,
                                          newDraft.qteRecuDRH - compSrh,
                                        );
                                      }
                                      newDraft.qteSrh = compSrh;
                                      newDraft.qteSfc = compSfc;
                                    } else {
                                      newDraft.qteSrh = 0;
                                      newDraft.qteSfc = 0;
                                    }
                                  }
                                }

                                setDistributionDrafts({
                                  ...distributionDrafts,
                                  [item.id]: newDraft,
                                });
                              };

                              return (
                                <tr
                                  key={item.id}
                                  onClick={() => setActiveDistItemId(item.id)}
                                  className={`cursor-pointer transition-colors text-black border-l-4 ${
                                    activeItem && activeItem.id === item.id
                                      ? "bg-amber-500/5 border-l-pink-500 hover:bg-amber-500/10"
                                      : "border-l-transparent hover:bg-slate-50/50"
                                  }`}
                                  style={{ color: "#000000" }}
                                >
                                  <td className="px-6 py-5">
                                    <div className="flex flex-col">
                                      <span className="font-extrabold text-black text-base">
                                        {item.name}
                                      </span>
                                      <span className="text-[10px] text-slate-800 font-mono font-bold mt-0.5">
                                        {item.nProduit} — {item.category}
                                      </span>
                                    </div>
                                  </td>

                                  {/* Qte Recu DRH Input */}
                                  <td
                                    className="px-4 py-5 bg-amber-50/20 text-center"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <div className="flex flex-col items-center gap-1">
                                      <input
                                        type="number"
                                        min="0"
                                        className="w-20 text-center p-2 rounded-xl border-2 border-slate-400 bg-white font-black text-sm text-black outline-none focus:ring-2 focus:ring-amber-500"
                                        value={draft.qteRecuDRH}
                                        onChange={(e) => {
                                          const val = Math.max(
                                            0,
                                            parseInt(e.target.value) || 0,
                                          );
                                          updateDraft({ qteRecuDRH: val });
                                        }}
                                      />
                                      <span className="text-[9px] text-amber-800 font-black tracking-widest uppercase">
                                        CHHL JA
                                      </span>
                                    </div>
                                  </td>

                                  {/* Demandes SRH & SFC */}
                                  <td
                                    className="px-4 py-5 bg-violet-50/10 text-center"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <div className="flex flex-col gap-2 items-center">
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-black text-violet-700 w-10 text-right">
                                          SRH:
                                        </span>
                                        <input
                                          type="number"
                                          min="0"
                                          className="w-16 text-center p-1.5 rounded-lg border border-slate-300 bg-white font-black text-xs text-black outline-none focus:ring-2 focus:ring-violet-500"
                                          value={draft.demandeSrh}
                                          onChange={(e) => {
                                            const val = Math.max(
                                              0,
                                              parseInt(e.target.value) || 0,
                                            );
                                            updateDraft({ demandeSrh: val });
                                          }}
                                        />
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-black text-sky-700 w-10 text-right">
                                          SFC:
                                        </span>
                                        <input
                                          type="number"
                                          min="0"
                                          className="w-16 text-center p-1.5 rounded-lg border border-slate-300 bg-white font-black text-xs text-black outline-none focus:ring-2 focus:ring-sky-500"
                                          value={draft.demandeSfc}
                                          onChange={(e) => {
                                            const val = Math.max(
                                              0,
                                              parseInt(e.target.value) || 0,
                                            );
                                            updateDraft({ demandeSfc: val });
                                          }}
                                        />
                                      </div>
                                      <span className="text-[9px] text-violet-800 font-black tracking-widest uppercase mt-0.5">
                                        Bghaw (Demandes)
                                      </span>
                                    </div>
                                  </td>

                                  {/* Livraisons Réelles SRH & SFC (Dotations) */}
                                  <td
                                    className="px-4 py-5 bg-emerald-50/10 text-center"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <div className="flex flex-col gap-2 items-center">
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-black text-violet-700 w-10 text-right">
                                          SRH:
                                        </span>
                                        <input
                                          type="number"
                                          min="0"
                                          className="w-16 text-center p-1.5 rounded-lg border-2 border-emerald-400 bg-white font-black text-xs text-black outline-none focus:ring-2 focus:ring-emerald-500"
                                          value={draft.qteSrh}
                                          onChange={(e) => {
                                            const val = Math.max(
                                              0,
                                              parseInt(e.target.value) || 0,
                                            );
                                            setDistributionDrafts({
                                              ...distributionDrafts,
                                              [item.id]: {
                                                ...draft,
                                                qteSrh: val,
                                              },
                                            });
                                          }}
                                        />
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-black text-sky-700 w-10 text-right">
                                          SFC:
                                        </span>
                                        <input
                                          type="number"
                                          min="0"
                                          className="w-16 text-center p-1.5 rounded-lg border-2 border-emerald-400 bg-white font-black text-xs text-black outline-none focus:ring-2 focus:ring-emerald-500"
                                          value={draft.qteSfc}
                                          onChange={(e) => {
                                            const val = Math.max(
                                              0,
                                              parseInt(e.target.value) || 0,
                                            );
                                            setDistributionDrafts({
                                              ...distributionDrafts,
                                              [item.id]: {
                                                ...draft,
                                                qteSfc: val,
                                              },
                                            });
                                          }}
                                        />
                                      </div>
                                      <span className="text-[9px] text-emerald-800 font-black tracking-widest uppercase mt-0.5">
                                        Donné (Doté)
                                      </span>
                                    </div>
                                  </td>

                                  {/* Le Manque calculated shortage */}
                                  <td className="px-4 py-5 bg-rose-50/10 text-center">
                                    <div className="flex flex-col gap-1 items-center justify-center">
                                      <span
                                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-black ${srhShortage > 0 ? "bg-rose-100 text-rose-700 border border-rose-200" : "bg-slate-100 text-slate-400"}`}
                                      >
                                        SRH:{" "}
                                        {srhShortage > 0
                                          ? `-${srhShortage}`
                                          : "OK"}
                                      </span>
                                      <span
                                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-black ${sfcShortage > 0 ? "bg-rose-100 text-rose-700 border border-rose-200" : "bg-slate-100 text-slate-400"}`}
                                      >
                                        SFC:{" "}
                                        {sfcShortage > 0
                                          ? `-${sfcShortage}`
                                          : "OK"}
                                      </span>
                                      <span className="text-[9px] text-rose-800 font-black tracking-widest uppercase mt-1">
                                        Le Manque
                                      </span>
                                    </div>
                                  </td>

                                  {/* Calculated Reste en Stock DRH */}
                                  <td className="px-4 py-5 bg-slate-100 text-center">
                                    <div className="flex flex-col items-center justify-center gap-1">
                                      <span
                                        className={`font-extrabold text-base px-2.5 py-1.5 rounded-lg border-2 ${
                                          remainingStockDRH > 0
                                            ? "text-emerald-950 bg-emerald-200 border-emerald-400 font-black"
                                            : "text-slate-500 bg-slate-200 border-slate-300"
                                        }`}
                                      >
                                        {remainingStockDRH}
                                      </span>
                                      <span className="text-[9px] text-slate-500 font-extrabold tracking-widest uppercase mt-0.5">
                                        RESTE
                                      </span>
                                    </div>
                                  </td>

                                  {/* Ok & Calculer Action */}
                                  <td
                                    className="px-6 py-5 text-right"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      onClick={async () => {
                                        await handleSaveDistribution(
                                          item.id,
                                          draft.qteRecuDRH,
                                          draft.demandeSrh,
                                          draft.demandeSfc,
                                          draft.qteSrh,
                                          draft.qteSfc,
                                          draft.syncStock,
                                        );
                                        showToast(
                                          `Distribution de "${item.name}" enregistrée et reste calculé !`,
                                        );
                                      }}
                                      className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-[10px] uppercase font-black tracking-wider transition-all active:scale-[0.98] shadow-md flex items-center gap-1 ml-auto text-center"
                                    >
                                      <CheckCircle2 size={12} />
                                      Ok
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                            {filteredDistItems.length === 0 && (
                              <tr>
                                <td
                                  colSpan={7}
                                  className="px-8 py-20 text-center text-slate-400 font-bold italic"
                                >
                                  Aucune fourniture trouvée pour cette
                                  recherche.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Right block (col-span-4): Real-time visual layout schematic copied from user's hard-drawn design */}
                    <div className="col-span-12 xl:col-span-4 text-black text-sans">
                      {activeItem ? (
                        (() => {
                          const draft = distributionDrafts[activeItem.id] || {
                            qteRecuDRH: activeItem.qteRecuDRH || 0,
                            demandeSrh: activeItem.demandeSrh || 0,
                            demandeSfc: activeItem.demandeSfc || 0,
                            qteSrh: activeItem.qteSrh || 0,
                            qteSfc: activeItem.qteSfc || 0,
                            syncStock: true,
                          };
                          const totalGiven = draft.qteSrh + draft.qteSfc;
                          const remainingStockDRH = Math.max(
                            0,
                            draft.qteRecuDRH - totalGiven,
                          );
                          const srhShortage = Math.max(
                            0,
                            draft.demandeSrh - draft.qteSrh,
                          );
                          const sfcShortage = Math.max(
                            0,
                            draft.demandeSfc - draft.qteSfc,
                          );
                          const isSuperposition =
                            draft.demandeSrh + draft.demandeSfc >
                            draft.qteRecuDRH;

                          return (
                            <div className="bg-slate-900 text-white rounded-[2.5rem] border border-slate-800 p-8 shadow-xl space-y-6 sticky top-6">
                              <div className="border-b border-slate-800 pb-4">
                                <span className="text-[9px] bg-pink-500/20 text-pink-400 border border-pink-500/30 px-2.5 py-1 rounded-full font-black uppercase tracking-widest">
                                  Schéma Interactif : {activeItem.nProduit}
                                </span>
                                <h5 className="font-black text-xl text-slate-100 uppercase tracking-tight mt-2 truncate">
                                  {activeItem.name}
                                </h5>
                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                                  Inspiré de votre concept visuel
                                </p>
                              </div>

                              {/* 1. Tableau Mère DRH Box */}
                              <div className="bg-slate-950/60 p-5 rounded-[1.8rem] border border-slate-800 relative overflow-hidden">
                                <div className="absolute top-0 left-0 h-1 bg-gradient-to-r from-amber-500 to-amber-300 w-full" />
                                <div className="flex justify-between items-center mb-1">
                                  <span className="text-xs text-amber-400 font-extrabold tracking-widest uppercase">
                                    Tableau Mère DRH
                                  </span>
                                  <span className="text-[10px] text-slate-500 font-mono font-bold">
                                    Réf: {activeItem.nProduit}
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 gap-4 mt-3">
                                  <div className="bg-white/5 p-3 rounded-xl border border-white/5 text-center">
                                    <span className="text-[9px] text-slate-400 font-bold uppercase block">
                                      Demande Totale
                                    </span>
                                    <span className="text-lg font-black text-white">
                                      {draft.demandeSrh + draft.demandeSfc}
                                    </span>
                                    <span className="text-[8px] text-slate-500 block mt-0.5">
                                      {activeItem.unit}
                                    </span>
                                  </div>
                                  <div className="bg-amber-500/10 p-3 rounded-xl border border-amber-500/10 text-center">
                                    <span className="text-[9px] text-amber-400 font-extrabold uppercase block">
                                      Niveau Reçu Réel
                                    </span>
                                    <span className="text-lg font-black text-amber-300">
                                      {draft.qteRecuDRH}
                                    </span>
                                    <span className="text-[8px] text-amber-500 block mt-0.5">
                                      CHHL JA
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Separator / Down Arrows */}
                              <div className="flex justify-around items-center h-8 relative">
                                <div className="absolute inset-x-0 h-px bg-slate-800/60 top-1/2 -translate-y-1/2" />
                                <div className="bg-slate-900 border border-slate-800 h-6 w-6 rounded-lg flex items-center justify-center text-slate-400 text-xs font-bold font-mono z-10 shadow-sm">
                                  ↓
                                </div>
                                <div className="bg-slate-900 border border-slate-800 h-6 w-6 rounded-lg flex items-center justify-center text-slate-400 text-xs font-bold font-mono z-10 shadow-sm">
                                  ↓
                                </div>
                              </div>

                              {/* 2. Services SFC & SRH (Split) */}
                              <div className="grid grid-cols-2 gap-4">
                                {/* SFC */}
                                <div className="bg-slate-950/40 p-4 rounded-[1.8rem] border border-slate-800/80 relative">
                                  <div className="flex items-center gap-1.5 justify-start mb-2">
                                    <span className="h-2 w-2 rounded-full bg-sky-400" />
                                    <span className="text-[10px] text-sky-400 font-black tracking-widest uppercase">
                                      Service SFC
                                    </span>
                                  </div>
                                  <div className="space-y-1.5 text-xs text-slate-300">
                                    <div className="flex justify-between font-semibold">
                                      <span>Bgha (Demande):</span>
                                      <span className="font-extrabold text-slate-200">
                                        {draft.demandeSfc}
                                      </span>
                                    </div>
                                    <div className="flex justify-between items-center text-emerald-400 font-bold bg-emerald-500/5 px-2 py-1 rounded">
                                      <span>Recu (Doté):</span>
                                      <span className="font-black text-sm">
                                        {draft.qteSfc}
                                      </span>
                                    </div>
                                    {sfcShortage > 0 ? (
                                      <div className="text-[10px] text-rose-450 font-bold bg-rose-500/10 px-2 py-0.5 rounded text-center border border-rose-500/20 mt-1">
                                        Na9s: -{sfcShortage}
                                      </div>
                                    ) : (
                                      <div className="text-[9px] text-emerald-400 font-extrabold text-center bg-emerald-500/10 py-0.5 rounded mt-1 uppercase tracking-wider">
                                        ✓ Satisfait
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* SRH */}
                                <div className="bg-slate-950/40 p-4 rounded-[1.8rem] border border-slate-800/80 relative">
                                  <div className="flex items-center gap-1.5 justify-start mb-2">
                                    <span className="h-2 w-2 rounded-full bg-purple-400" />
                                    <span className="text-[10px] text-purple-400 font-black tracking-widest uppercase">
                                      Service SRH
                                    </span>
                                  </div>
                                  <div className="space-y-1.5 text-xs text-slate-300">
                                    <div className="flex justify-between font-semibold">
                                      <span>Bgha (Demande):</span>
                                      <span className="font-extrabold text-slate-200">
                                        {draft.demandeSrh}
                                      </span>
                                    </div>
                                    <div className="flex justify-between items-center text-emerald-400 font-bold bg-emerald-500/5 px-2 py-1 rounded">
                                      <span>Recu (Doté):</span>
                                      <span className="font-black text-sm">
                                        {draft.qteSrh}
                                      </span>
                                    </div>
                                    {srhShortage > 0 ? (
                                      <div className="text-[10px] text-rose-450 font-bold bg-rose-500/10 px-2 py-0.5 rounded text-center border border-rose-500/20 mt-1">
                                        Na9s: -{srhShortage}
                                      </div>
                                    ) : (
                                      <div className="text-[9px] text-emerald-400 font-extrabold text-center bg-emerald-500/10 py-0.5 rounded mt-1 uppercase tracking-wider">
                                        ✓ Satisfait
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Another arrow */}
                              <div className="flex justify-center items-center h-4 relative">
                                <div className="absolute inset-x-0 h-px bg-slate-800/60 top-1/2 -translate-y-1/2" />
                                <div className="bg-slate-900 border border-slate-800 h-6 w-6 rounded-lg flex items-center justify-center text-slate-400 text-xs font-bold font-mono z-10 shadow-sm">
                                  ↓
                                </div>
                              </div>

                              {/* 3. RESTE Box */}
                              <div className="bg-slate-950 p-5 rounded-[1.8rem] border border-slate-800">
                                <div className="flex justify-between items-center mb-1">
                                  <span className="text-[10px] text-slate-400 font-black tracking-widest uppercase">
                                    Reste en Stock (Le Reste)
                                  </span>
                                  <span className="text-[9px] text-emerald-400 font-mono font-bold bg-emerald-500/5 px-2 py-0.5 rounded">
                                    Reçu - (SFC + SRH)
                                  </span>
                                </div>
                                <div className="flex items-center justify-between mt-3 bg-slate-900/60 p-3 rounded-2xl border border-slate-850">
                                  <div className="text-left font-sans">
                                    <div className="text-xl font-black text-white">
                                      {remainingStockDRH}{" "}
                                      <span className="text-xs text-slate-400 font-normal">
                                        {activeItem.unit}
                                      </span>
                                    </div>
                                    <div className="text-[9px] text-slate-400 font-semibold mt-0.5">
                                      Calculé: {draft.qteRecuDRH} - {totalGiven}{" "}
                                      = {remainingStockDRH}
                                    </div>
                                  </div>
                                  <div className="h-10 w-10 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center font-black text-base text-emerald-400">
                                    {remainingStockDRH}
                                  </div>
                                </div>
                              </div>

                              {/* Case Rule indicator directly inspired by the hand-drawn drawing: superpositions cases */}
                              <div
                                className="p-4 rounded-xl text-[10.5px] font-bold leading-relaxed border"
                                style={{
                                  backgroundColor: isSuperposition
                                    ? "rgba(244, 63, 94, 0.05)"
                                    : "rgba(16, 185, 129, 0.05)",
                                  borderColor: isSuperposition
                                    ? "rgba(244, 63, 94, 0.2)"
                                    : "rgba(16, 185, 129, 0.2)",
                                  color: isSuperposition
                                    ? "#fda4af"
                                    : "#6ee7b7",
                                }}
                              >
                                {isSuperposition ? (
                                  <div>
                                    <span className="font-extrabold uppercase block mb-1">
                                      ⚠️ CAS 1 : Demande &gt; Reçu
                                      (Superposition)
                                    </span>
                                    Le total bghaw (
                                    {draft.demandeSfc + draft.demandeSrh})
                                    dépasse le reçu DRH ({draft.qteRecuDRH}). Le
                                    reste de{" "}
                                    {draft.demandeSfc +
                                      draft.demandeSrh -
                                      draft.qteRecuDRH}{" "}
                                    sera comblé lors des prochains arrivages.
                                  </div>
                                ) : (
                                  <div>
                                    <span className="font-extrabold uppercase block mb-1">
                                      ✅ CAS 2 : Reçu &gt;= Demande (Stock Ok)
                                    </span>
                                    Tout est disponible ! Reste en stock{" "}
                                    {remainingStockDRH} {activeItem.unit}s
                                    calculés avec succès.
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })()
                      ) : (
                        <div className="bg-slate-900 text-slate-400 text-center rounded-[2.5rem] border border-slate-800 p-8 shadow-xl py-20 italic">
                          Sélectionnez un article pour afficher le schéma
                          interactif
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })()}

          {view === "demandes" && (
            <motion.div
              key="demandes"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6 animate-fade-in"
            >
              {/* Top Banner */}
              <div className="flex justify-between items-center bg-gradient-to-r from-indigo-900 via-purple-950 to-indigo-900 p-6 rounded-[2rem] text-white">
                <div className="flex items-center gap-4">
                  <FileText className="text-indigo-400" size={32} />
                  <div>
                    <h4 className="font-bold text-xl uppercase tracking-tighter text-indigo-100">
                      Registre des Demandes de Fournitures
                    </h4>
                    <p className="text-xs text-indigo-300 font-bold uppercase tracking-widest mt-0.5">
                      Suivi, statut d'attribution et dotation automatisée
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <select
                    className="px-4 py-2 bg-white/10 border border-white/10 rounded-xl text-xs font-black uppercase text-white tracking-wider outline-none focus:ring-2 focus:ring-indigo-500 appearance-none min-w-[200px] cursor-pointer font-bold"
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value as any)}
                  >
                    <option
                      value="ALL"
                      className="bg-indigo-950 text-white font-bold"
                    >
                      Tous les services / demandeurs
                    </option>
                    {Object.values(Category).map((c) => (
                      <option
                        key={c}
                        value={c}
                        className="bg-indigo-950 text-white font-bold"
                      >
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Table listing */}
              <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden text-slate-800">
                <table className="w-full text-left font-sans">
                  <thead>
                    <tr className="bg-slate-50/50 text-[10px] uppercase tracking-[0.2em] text-slate-400 font-black border-b border-slate-100">
                      <th className="px-8 py-6">Date</th>
                      <th className="px-8 py-6">Demandeur / Service</th>
                      <th className="px-8 py-6">Fourniture demandée</th>
                      <th className="px-8 py-6 text-center">Qté Demandée</th>
                      <th className="px-8 py-6 text-center">Status</th>
                      <th className="px-8 py-6 text-center">
                        Qté Accordée (Perçue)
                      </th>
                      <th className="px-8 py-6 text-right">
                        Actions / Décision
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {supplyRequests
                      .filter((req) => {
                        const matchesSearch =
                          req.itemName
                            .toLowerCase()
                            .includes(searchQuery.toLowerCase()) ||
                          req.requesterName
                            .toLowerCase()
                            .includes(searchQuery.toLowerCase());
                        const matchesDept =
                          categoryFilter === "ALL" ||
                          req.requesterDepartment === categoryFilter;
                        return matchesSearch && matchesDept;
                      })
                      .map((req) => {
                        return (
                          <tr
                            key={req.id}
                            className="hover:bg-slate-50/30 transition-all duration-200"
                          >
                            <td className="px-8 py-6 text-xs text-slate-500 font-bold whitespace-nowrap">
                              {new Date(req.requestDate).toLocaleDateString(
                                "fr-FR",
                                {
                                  day: "2-digit",
                                  month: "2-digit",
                                  year: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                },
                              )}
                            </td>
                            <td className="px-8 py-6">
                              <div className="flex flex-col">
                                <span className="font-bold text-slate-900 text-sm">
                                  {req.requesterName}
                                </span>
                                <span className="text-[9px] font-black uppercase tracking-widest text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded w-fit mt-1">
                                  {req.requesterDepartment}
                                </span>
                              </div>
                            </td>
                            <td className="px-8 py-6">
                              <div className="flex flex-col">
                                <span className="font-bold text-slate-800 text-sm">
                                  {req.itemName}
                                </span>
                                <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 bg-slate-100 text-slate-500 rounded w-fit mt-1">
                                  {req.itemCategory}
                                </span>
                              </div>
                            </td>
                            <td className="px-8 py-6 text-center font-black text-slate-700">
                              {req.requestedQuantity}
                            </td>
                            <td className="px-8 py-6 text-center">
                              {req.status === "PENDING" && (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-amber-50 text-amber-600 border border-amber-100">
                                  En attente
                                </span>
                              )}
                              {req.status === "APPROVED" && (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-600 border border-emerald-100">
                                  Approuvée
                                </span>
                              )}
                              {req.status === "REJECTED" && (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-rose-50 text-rose-600 border border-rose-100">
                                  Rejetée
                                </span>
                              )}
                            </td>
                            <td className="px-8 py-6 text-center">
                              {req.status === "APPROVED" ? (
                                <span className="font-extrabold text-emerald-600 text-base">
                                  {req.validatedQuantity}
                                </span>
                              ) : req.status === "REJECTED" ? (
                                <span className="text-slate-300 font-bold font-mono">
                                  -
                                </span>
                              ) : (
                                <span className="text-amber-500 font-semibold text-xs italic">
                                  En attente
                                </span>
                              )}
                            </td>
                            <td className="px-8 py-6 text-right font-sans">
                              {req.status === "PENDING" ? (
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={() => {
                                      setSelectedSupplyRequest(req);
                                      setModalType("validateSupplyRequest");
                                      setIsModalOpen(true);
                                    }}
                                    className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-slate-800 transition-all active:scale-95"
                                  >
                                    Traiter
                                  </button>
                                </div>
                              ) : (
                                <div className="flex flex-col text-right">
                                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                                    Traité le{" "}
                                    {req.validationDate
                                      ? new Date(
                                          req.validationDate,
                                        ).toLocaleDateString("fr-FR")
                                      : "-"}
                                  </span>
                                  {req.observation && (
                                    <span className="text-[11px] text-slate-500 italic truncate max-w-[180px] mt-0.5">
                                      "{req.observation}"
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    {supplyRequests.filter((req) => {
                      const matchesSearch =
                        req.itemName
                          .toLowerCase()
                          .includes(searchQuery.toLowerCase()) ||
                        req.requesterName
                          .toLowerCase()
                          .includes(searchQuery.toLowerCase());
                      const matchesDept =
                        categoryFilter === "ALL" ||
                        req.requesterDepartment === categoryFilter;
                      return matchesSearch && matchesDept;
                    }).length === 0 && (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-8 py-20 text-center text-slate-300 font-medium italic"
                        >
                          Aucune demande de fourniture enregistrée
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {(view === "history" || view === "entrées" || view === "sorties") && (
            <motion.div
              key="history"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-50 p-6 rounded-3xl border border-slate-100">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-black uppercase text-slate-400 tracking-wider pl-1">
                    Filtrer par catégorie:
                  </span>
                  <select
                    className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl font-bold text-slate-700 text-sm shadow-sm outline-none focus:ring-2 focus:ring-slate-900 transition-all"
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value as any)}
                  >
                    <option value="ALL">Toutes catégories</option>
                    {Object.values(Category).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                {categoryFilter !== "ALL" && (
                  <button
                    onClick={() => setCategoryFilter("ALL")}
                    className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-xl text-xs font-bold text-slate-700 transition active:scale-95"
                  >
                    Réinitialiser le filtre
                  </button>
                )}
              </div>

              {/* SECTION: SAISIE RAPIDE & LISTE DES FOURNITURES */}
              <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm p-8 space-y-4">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                  <div>
                    <h4 className="font-black text-lg text-slate-900 uppercase tracking-tight flex items-center gap-2">
                      📦 {view === "entrées" ? "Saisie Rapide des Entrées Stock" : view === "sorties" ? "Saisie Rapide des Sorties Stock" : "Saisie des Mouvements de Stock"}
                    </h4>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">
                      {view === "entrées" ? "Enregistrez une entrée de stock pour n'importe quelle fourniture" : view === "sorties" ? "Attribuez une dotation / sortie de stock" : "Gérez les entrées de réception ou sorties de dotation"}
                    </p>
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-wider px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg">
                    {filteredItems.length} article(s) trouvé(s)
                  </span>
                </div>

                <div className="border border-slate-100 rounded-3xl overflow-hidden shadow-inner max-h-[340px] overflow-y-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-slate-50 z-10 border-b border-indigo-50 shadow-sm">
                      <tr className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-black">
                        <th className="px-6 py-4">Nom de la Fourniture</th>
                        <th className="px-6 py-4">Catégorie</th>
                        <th className="px-6 py-4">Stock Actuel</th>
                        <th className="px-6 py-4 text-right">Action Directe</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {filteredItems.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-6 py-12 text-center text-slate-400 font-bold italic">
                            Aucune fourniture ne correspond à vos critères de recherche.
                          </td>
                        </tr>
                      ) : (
                        filteredItems.map((item) => (
                          <tr key={item.id} className="hover:bg-slate-50/50 transition-all duration-150">
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="h-8 w-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-500 font-bold text-[10px]">
                                  {item.category ? item.category[0] : "F"}
                                </div>
                                <div>
                                  <p className="font-bold text-sm text-slate-900">{item.name}</p>
                                  <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest">
                                    {item.nProduit}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className="text-[9px] font-black uppercase tracking-widest px-2.5 py-1 bg-slate-100 text-slate-500 rounded-lg">
                                {item.category}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <span className={`font-black text-sm ${getItemRemainingStock(item) <= item.minStock ? "text-rose-500 font-black" : "text-slate-700"}`}>
                                {getItemRemainingStock(item)}{" "}
                                <span className="text-[10px] text-slate-300">{item.unit || "unités"}</span>
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              {view === "entrées" ? (
                                <button
                                  onClick={() => {
                                    setSelectedItem(item);
                                    setQuickMovementType(TransactionType.INCOMING);
                                    setModalType("updateStock");
                                    setIsModalOpen(true);
                                  }}
                                  className="px-4 py-2 bg-emerald-50 hover:bg-emerald-600 hover:text-white text-emerald-600 rounded-xl text-xs font-black uppercase tracking-wide transition-all active:scale-95 flex items-center gap-1.5 ml-auto border border-emerald-100 shadow-sm font-bold"
                                >
                                  <ArrowDownLeft size={14} />
                                  Entrée Stock
                                </button>
                              ) : view === "sorties" ? (
                                <button
                                  onClick={() => {
                                    setSelectedItem(item);
                                    setQuickMovementType(TransactionType.OUTGOING);
                                    setModalType("updateStock");
                                    setIsModalOpen(true);
                                  }}
                                  className="px-4 py-2 bg-rose-50 hover:bg-rose-600 hover:text-white text-rose-600 rounded-xl text-xs font-black uppercase tracking-wide transition-all active:scale-95 flex items-center gap-1.5 ml-auto border border-rose-100 shadow-sm font-bold"
                                >
                                  <ArrowUpRight size={14} />
                                  Sortie Stock
                                </button>
                              ) : (
                                <div className="flex justify-end gap-1.5">
                                  <button
                                    onClick={() => {
                                      setSelectedItem(item);
                                      setQuickMovementType(TransactionType.INCOMING);
                                      setModalType("updateStock");
                                      setIsModalOpen(true);
                                    }}
                                    title="Saisir entrée"
                                    className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-600 hover:text-white text-emerald-600 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 font-bold"
                                  >
                                    + Entrée
                                  </button>
                                  <button
                                    onClick={() => {
                                      setSelectedItem(item);
                                      setQuickMovementType(TransactionType.OUTGOING);
                                      setModalType("updateStock");
                                      setIsModalOpen(true);
                                    }}
                                    title="Saisir sortie"
                                    className="px-3 py-1.5 bg-rose-50 hover:bg-rose-600 hover:text-white text-rose-600 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 font-bold"
                                  >
                                    - Sortie
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* RE-ENTRY OF LEDGER SECTION HEADER */}
              <div className="pt-4">
                <h4 className="font-black text-lg text-slate-900 uppercase tracking-tight flex items-center gap-2 px-1">
                  📜 {view === "entrées" ? "Registre des Écritures d'Entrées" : view === "sorties" ? "Registre des Écritures de Sorties" : "Registre Général des Flux"}
                </h4>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1 px-1">
                  Historique détaillé des mouvements enregistrés pour les fournitures
                </p>
              </div>

              <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50/50 text-[10px] uppercase tracking-[0.2em] text-slate-400 font-black border-b border-slate-100">
                      <th className="px-8 py-6">Date et Heure</th>
                      <th className="px-8 py-6">Mouvement</th>
                      <th className="px-8 py-6">Produit</th>
                      <th className="px-8 py-6">Quantité</th>
                      <th className="px-8 py-6">Bénéficiaire / Motif</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {(() => {
                      const list = transactions
                        .filter((t) => {
                          if (view === "entrées")
                            return t.type === TransactionType.INCOMING;
                          if (view === "sorties")
                            return t.type === TransactionType.OUTGOING;
                          return true;
                        })
                        .filter((t) => {
                          // Search query filter
                          const matchesSearch =
                            t.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            (t.designationPrestation || "")
                              .toLowerCase()
                              .includes(searchQuery.toLowerCase()) ||
                            (t.observation || "")
                              .toLowerCase()
                              .includes(searchQuery.toLowerCase());

                          // Category filter
                          let matchesCategory = true;
                          if (categoryFilter !== "ALL") {
                            const item = items.find((i) => i.id === t.itemId);
                            matchesCategory = item ? item.category === categoryFilter : false;
                          }

                          return matchesSearch && matchesCategory;
                        });

                      if (list.length === 0) {
                        return (
                          <tr>
                            <td
                              colSpan={5}
                              className="px-8 py-20 text-center text-slate-400 font-bold italic"
                            >
                              Aucun mouvement enregistré pour cette sélection.
                            </td>
                          </tr>
                        );
                      }

                      return list.map((t) => (
                        <tr
                          key={t.id}
                          className="hover:bg-slate-50/30 transition-all duration-200"
                        >
                          <td className="px-8 py-6">
                            <div className="flex flex-col">
                              <span className="font-bold text-slate-900">
                                {new Date(t.date).toLocaleDateString("fr-FR", {
                                  day: "numeric",
                                  month: "short",
                                })}
                              </span>
                              <span className="text-[10px] text-slate-300 font-black tracking-tight">
                                {new Date(t.date).toLocaleTimeString("fr-FR", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>
                          </td>
                          <td className="px-8 py-6">
                            <StatusBadge type={t.type} />
                          </td>
                          <td className="px-8 py-6 font-bold text-slate-700">
                            {t.itemName}
                          </td>
                          <td
                            className={`px-8 py-6 font-black text-lg ${t.type === TransactionType.INCOMING ? "text-emerald-500" : "text-rose-500"}`}
                          >
                            {t.type === TransactionType.INCOMING ? "+" : "-"}
                            {t.quantity}
                          </td>
                          <td className="px-8 py-6 text-sm font-medium text-slate-400 italic">
                            {t.designationPrestation}
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {view === "rapport_mensuel" && (
            <motion.div
              key="rapport_mensuel"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              {/* Header Banner */}
              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center bg-gradient-to-r from-emerald-900 via-teal-950 to-emerald-900 p-8 rounded-[2rem] text-white shadow-xl gap-6">
                <div className="flex items-center gap-5">
                  <div className="h-14 w-14 bg-white/10 rounded-2xl flex items-center justify-center border border-white/10 shadow-inner">
                    <CalendarRange className="text-emerald-400" size={32} />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-2xl uppercase tracking-tight text-emerald-50">
                      Rapport Mensuel de Distribution
                    </h4>
                    <p className="text-xs text-emerald-300 font-bold uppercase tracking-widest mt-1">
                      Fiche de fin de mois pour le DRH, SRH, SFC
                    </p>
                  </div>
                </div>

                {/* Pickers & Controls */}
                <div className="flex flex-wrap gap-3 w-full lg:w-auto">
                  <div className="flex flex-col gap-1 shrink-0">
                    <label className="text-[10px] font-black uppercase tracking-wider text-emerald-300 pl-1">Mois</label>
                    <select
                      className="px-4 py-2.5 bg-white/10 border border-white/10 hover:border-white/20 rounded-xl text-xs font-bold text-white tracking-wider outline-none focus:ring-2 focus:ring-emerald-400 appearance-none cursor-pointer min-w-[140px] focus:bg-teal-950"
                      value={reportMonth}
                      onChange={(e) => setReportMonth(Number(e.target.value))}
                    >
                      {[
                        "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
                        "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
                      ].map((name, index) => (
                        <option key={index} value={index} className="bg-teal-950 text-white font-bold">
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1 shrink-0">
                    <label className="text-[10px] font-black uppercase tracking-wider text-emerald-300 pl-1">Année</label>
                    <select
                      className="px-4 py-2.5 bg-white/10 border border-white/10 hover:border-white/20 rounded-xl text-xs font-bold text-white tracking-wider outline-none focus:ring-2 focus:ring-emerald-400 appearance-none cursor-pointer min-w-[100px] focus:bg-teal-950"
                      value={reportYear}
                      onChange={(e) => setReportYear(Number(e.target.value))}
                    >
                      {[2024, 2025, 2026, 2027, 2028, 2029, 2030].map((year) => (
                        <option key={year} value={year} className="bg-teal-950 text-white font-bold">
                          {year}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex gap-2 items-end pt-5 lg:pt-0 w-full lg:w-auto">
                    <button
                      onClick={handlePrint}
                      className="flex-1 lg:flex-none flex items-center justify-center gap-2 px-5 py-2.5 bg-white text-teal-950 hover:bg-emerald-50 rounded-xl text-xs font-black uppercase tracking-wide transition active:scale-95 shadow-md cursor-pointer"
                    >
                      <Printer size={16} /> Imprimer / PDF
                    </button>
                    <button
                      onClick={handleExportCSV}
                      className="flex-1 lg:flex-none flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-black uppercase tracking-wide transition active:scale-95 shadow-md cursor-pointer border border-emerald-400"
                    >
                      <Download size={16} /> Exporter Excel
                    </button>
                  </div>
                </div>
              </div>

              {/* Department Level Selectors */}
              <div className="bg-white p-4 rounded-[2rem] border border-slate-100 shadow-sm flex flex-wrap gap-2">
                <button
                  onClick={() => setReportDept("ALL")}
                  className={`px-5 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 ${
                    reportDept === "ALL"
                      ? "bg-slate-900 text-white shadow-md shadow-slate-900/10 scale-[1.02]"
                      : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                  }`}
                >
                  Tous les Services (DRH + SRH + SFC)
                </button>
                <button
                  onClick={() => setReportDept(Category.DRH)}
                  className={`px-5 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 ${
                    reportDept === Category.DRH
                      ? "bg-amber-500 text-white shadow-md shadow-amber-500/10 scale-[1.02]"
                      : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                  }`}
                >
                  🏢 Section DRH
                </button>
                <button
                  onClick={() => setReportDept(Category.SRH)}
                  className={`px-5 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 ${
                    reportDept === Category.SRH
                      ? "bg-violet-600 text-white shadow-md shadow-violet-600/10 scale-[1.02]"
                      : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                  }`}
                >
                  👤 Section SRH
                </button>
                <button
                  onClick={() => setReportDept(Category.SFC)}
                  className={`px-5 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 ${
                    reportDept === Category.SFC
                      ? "bg-sky-500 text-white shadow-md shadow-sky-500/10 scale-[1.02]"
                      : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                  }`}
                >
                  💰 Section SFC
                </button>
              </div>

              {/* KPI STATS ROW */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Demandes Mensuelles</span>
                    <h3 className="text-3xl font-black text-slate-800 mt-1">{filteredRequests.length}</h3>
                    <p className="text-xs text-slate-400 font-semibold leading-relaxed mt-1">Formulaires déposés dans le mois</p>
                  </div>
                  <div className="h-12 w-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center">
                    <FileText size={22} />
                  </div>
                </div>

                <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Dotations Directes</span>
                    <h3 className="text-3xl font-black text-slate-800 mt-1">
                      {filteredTransactions.reduce((acc, t) => acc + Number(t.quantity), 0)}
                    </h3>
                    <p className="text-xs text-slate-400 font-semibold leading-relaxed mt-1">Fournitures sorties sans formulaire</p>
                  </div>
                  <div className="h-12 w-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center">
                    <ArrowUpRight size={22} />
                  </div>
                </div>

                <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Consommation Globale</span>
                    <h3 className="text-3xl font-black text-emerald-600 mt-1">
                      {consolidatedSummary.reduce((acc, i) => acc + i.approvedQty + i.directExitQty, 0)}
                    </h3>
                    <p className="text-xs text-slate-400 font-semibold leading-relaxed mt-1">Total général des articles reçus/dotés</p>
                  </div>
                  <div className="h-12 w-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center">
                    <CheckCircle2 size={22} />
                  </div>
                </div>
              </div>

              {/* SUB TAB LAYOUT SWITCHER */}
              <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
                <div className="flex border-b border-slate-100 bg-slate-50/50 p-2 gap-1">
                  <button
                    onClick={() => setReportSubTab("summary")}
                    className={`flex-1 md:flex-none px-6 py-3.5 rounded-2xl text-xs font-black uppercase tracking-wider transition-all ${
                      reportSubTab === "summary"
                        ? "bg-white text-slate-800 shadow-sm border border-slate-200/50"
                        : "text-slate-400 hover:text-slate-800"
                    }`}
                  >
                    📦 Résumé Consolidé des Fournitures
                  </button>
                  <button
                    onClick={() => setReportSubTab("requests")}
                    className={`flex-1 md:flex-none px-6 py-3.5 rounded-2xl text-xs font-black uppercase tracking-wider transition-all ${
                      reportSubTab === "requests"
                        ? "bg-white text-slate-800 shadow-sm border border-slate-200/50"
                        : "text-slate-400 hover:text-slate-800"
                    }`}
                  >
                    📥 Détail des Demandes ({filteredRequests.length})
                  </button>
                  <button
                    onClick={() => setReportSubTab("distributions")}
                    className={`flex-1 md:flex-none px-6 py-3.5 rounded-2xl text-xs font-black uppercase tracking-wider transition-all ${
                      reportSubTab === "distributions"
                        ? "bg-white text-slate-800 shadow-sm border border-slate-200/50"
                        : "text-slate-400 hover:text-slate-800"
                    }`}
                  >
                    📤 Dotations Directes ({filteredTransactions.length})
                  </button>
                </div>

                {/* Sub-tab 1: Summary */}
                {reportSubTab === "summary" && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/20 text-[10px] uppercase tracking-[0.2em] text-slate-400 font-black border-b border-slate-100">
                          <th className="px-8 py-5">Désignation</th>
                          <th className="px-8 py-5">Catégorie d'Origine</th>
                          <th className="px-8 py-5 text-center">Unité</th>
                          <th className="px-8 py-5 text-center">Qté Demandée (Formelle)</th>
                          <th className="px-8 py-5 text-center">Qté Approuvée (Formelle)</th>
                          <th className="px-8 py-5 text-center">Dotations Directes</th>
                          <th className="px-8 py-5 text-center bg-slate-50/50 text-indigo-700 font-extrabold">Flux Total Consommé</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {consolidatedSummary.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-8 py-16 text-center text-slate-400 font-bold italic">
                              Aucun article consommé/demandé sur cette période pour {reportDept === "ALL" ? "ces services" : reportDept}.
                            </td>
                          </tr>
                        ) : (
                          consolidatedSummary.map((item) => (
                            <tr key={item.itemId} className="hover:bg-slate-50/40 transition gap-2">
                              <td className="px-8 py-5 text-sm font-bold text-slate-800">{item.itemName}</td>
                              <td className="px-8 py-5">
                                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide bg-slate-100 px-3 py-1.5 rounded-xl">{item.category}</span>
                              </td>
                              <td className="px-8 py-5 text-center text-xs font-black text-slate-400">{item.unit}</td>
                              <td className="px-8 py-5 text-center font-bold text-slate-600">{item.requestedQty}</td>
                              <td className="px-8 py-5 text-center font-black text-emerald-600">{item.approvedQty}</td>
                              <td className="px-8 py-5 text-center font-black text-rose-500">{item.directExitQty}</td>
                              <td className="px-8 py-5 text-center text-base font-extrabold text-indigo-700 bg-indigo-50/20">
                                {item.approvedQty + item.directExitQty}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Sub-tab 2: Requests Detail */}
                {reportSubTab === "requests" && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/20 text-[10px] uppercase tracking-[0.2em] text-slate-400 font-black border-b border-slate-100">
                          <th className="px-8 py-5">Demandeur</th>
                          <th className="px-8 py-5">Service</th>
                          <th className="px-8 py-5">Article Demandé</th>
                          <th className="px-8 py-5 text-center">Qté Demandée</th>
                          <th className="px-8 py-5 text-center">Qté Validée</th>
                          <th className="px-8 py-5 text-center">Date Demande</th>
                          <th className="px-8 py-5 text-center">Statut</th>
                          <th className="px-8 py-5">Observations</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredRequests.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="px-8 py-16 text-center text-slate-400 font-bold italic">
                              Aucune demande formelle enregistrée sur cette période.
                            </td>
                          </tr>
                        ) : (
                          filteredRequests.map((req) => (
                            <tr key={req.id} className="hover:bg-slate-50/40 transition">
                              <td className="px-8 py-5 text-sm font-extrabold text-slate-700">{req.requesterName}</td>
                              <td className="px-8 py-5">
                                <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-xl ${
                                  req.requesterDepartment === Category.DRH ? "bg-amber-100 text-amber-800" :
                                  req.requesterDepartment === Category.SRH ? "bg-violet-100 text-violet-800" :
                                  "bg-sky-100 text-sky-800"
                                }`}>
                                  {req.requesterDepartment}
                                </span>
                              </td>
                              <td className="px-8 py-5 text-sm font-bold text-slate-800">{req.itemName}</td>
                              <td className="px-8 py-5 text-center font-bold text-slate-600">{req.requestedQuantity}</td>
                              <td className="px-8 py-5 text-center font-black text-slate-800">{req.validatedQuantity !== undefined ? req.validatedQuantity : "-"}</td>
                              <td className="px-8 py-5 text-center text-xs font-bold text-slate-400">
                                {new Date(req.requestDate).toLocaleDateString("fr-FR")}
                              </td>
                              <td className="px-8 py-5 text-center">
                                <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-xl border ${
                                  req.status === "APPROVED" ? "bg-emerald-50 text-emerald-700 border-emerald-100" :
                                  req.status === "REJECTED" ? "bg-rose-50 text-rose-700 border-rose-100" :
                                  "bg-amber-50 text-amber-700 border border-amber-100"
                                }`}>
                                  {req.status === "APPROVED" ? "Approuvé" : req.status === "REJECTED" ? "Rejeté" : "En cours"}
                                </span>
                              </td>
                              <td className="px-8 py-5 text-xs text-slate-400 italic font-medium max-w-[200px] truncate" title={req.observation}>
                                {req.observation || "-"}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Sub-tab 3: Outgoing Direct Distributions Detail */}
                {reportSubTab === "distributions" && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/20 text-[10px] uppercase tracking-[0.2em] text-slate-400 font-black border-b border-slate-100">
                          <th className="px-8 py-5">Article Doté</th>
                          <th className="px-8 py-5 text-center">Quantité Distribuée</th>
                          <th className="px-8 py-5 text-center">Date Dotation</th>
                          <th className="px-8 py-5">Désignation / Motif</th>
                          <th className="px-8 py-5">Observations</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredTransactions.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-8 py-16 text-center text-slate-400 font-bold italic">
                              Aucune dotation ou sortie directe correspondante pour cette période.
                            </td>
                          </tr>
                        ) : (
                          filteredTransactions.map((tx) => (
                            <tr key={tx.id} className="hover:bg-slate-50/40 transition">
                              <td className="px-8 py-5 text-sm font-bold text-slate-800">{tx.itemName}</td>
                              <td className="px-8 py-5 text-center text-sm font-black text-rose-600">-{tx.quantity}</td>
                              <td className="px-8 py-5 text-center text-xs font-bold text-slate-400">
                                {new Date(tx.date).toLocaleDateString("fr-FR")}
                              </td>
                              <td className="px-8 py-5 text-xs font-bold text-slate-600 uppercase max-w-[250px] truncate" title={tx.designationPrestation}>
                                {tx.designationPrestation}
                              </td>
                              <td className="px-8 py-5 text-xs text-slate-400 italic font-medium max-w-[200px] truncate" title={tx.observation}>
                                {tx.observation || "-"}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={`relative bg-white w-full rounded-[3rem] shadow-2xl overflow-hidden p-10 flex flex-col transition-all duration-300 ${
                modalType === "addItem" ? "max-w-4xl max-h-[90vh]" : "max-w-xl"
              }`}
            >
              {modalType === "addItem" && (
                <AddItemForm
                  initialCategory={
                    categoryFilter !== "ALL"
                      ? categoryFilter
                      : Category.STATIONERY
                  }
                  onSubmit={handleAddItem}
                  onCancel={() => setIsModalOpen(false)}
                />
              )}
              {modalType === "updateStock" && selectedItem && (
                <UpdateStockForm
                  item={selectedItem}
                  defaultType={quickMovementType}
                  onSubmit={(
                    amount,
                    type,
                    designationPrestation,
                    observation,
                  ) =>
                    handleUpdateStock(
                      selectedItem.id,
                      amount,
                      type,
                      designationPrestation,
                      observation,
                    )
                  }
                  onCancel={() => setIsModalOpen(false)}
                />
              )}
              {modalType === "editServiceSupply" && selectedItem && (
                <EditServiceSupplyForm
                  item={selectedItem}
                  onSubmit={(updatedFields) =>
                    handleSaveServiceSupply(selectedItem.id, updatedFields)
                  }
                  onCancel={() => setIsModalOpen(false)}
                />
              )}
              {modalType === "quickMovement" && (
                <QuickMovementForm
                  items={
                    view === "drh"
                      ? items.filter((i) => i.category === Category.DRH)
                      : view === "srh"
                        ? items.filter((i) => i.category === Category.SRH)
                        : view === "sfc"
                          ? items.filter((i) => i.category === Category.SFC)
                          : items
                  }
                  defaultType={quickMovementType}
                  onSubmit={(
                    itemId,
                    amount,
                    type,
                    designationPrestation,
                    observation,
                  ) =>
                    handleUpdateStock(
                      itemId,
                      amount,
                      type,
                      designationPrestation,
                      observation,
                    )
                  }
                  onCancel={() => setIsModalOpen(false)}
                />
              )}
              {modalType === "createSupplyRequest" && (
                <CreateSupplyRequestForm
                  items={items}
                  onSubmit={handleCreateSupplyRequest}
                  onCancel={() => setIsModalOpen(false)}
                />
              )}
              {modalType === "validateSupplyRequest" &&
                selectedSupplyRequest && (
                  <ValidateSupplyRequestForm
                    request={selectedSupplyRequest}
                    items={items}
                    onSubmit={(status, validatedQuantity, observation) =>
                      handleValidateSupplyRequest(
                        selectedSupplyRequest.id,
                        status,
                        validatedQuantity,
                        observation,
                      )
                    }
                    onCancel={() => setIsModalOpen(false)}
                  />
                )}
              {modalType === "deleteItem" && selectedItem && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-2xl font-black tracking-tight text-slate-900 flex items-center gap-2">
                      <Trash2 className="text-rose-500 animate-pulse" size={24} />
                      Supprimer la fourniture
                    </h3>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                      Confirmer la suppression de l'article
                    </p>
                  </div>

                  <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 space-y-3">
                    <p className="text-sm font-semibold text-slate-700">
                      Êtes-vous sûr de vouloir supprimer l'article suivant ?
                    </p>
                    <div className="flex gap-4 items-center">
                      <div className="h-10 w-10 bg-rose-50 rounded-xl flex items-center justify-center text-rose-500 font-bold text-xs">
                        {selectedItem.category ? selectedItem.category[0] : "I"}
                      </div>
                      <div>
                        <p className="font-bold text-slate-900">{selectedItem.name}</p>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{selectedItem.nProduit}</p>
                      </div>
                    </div>
                    <p className="text-xs text-rose-500 font-bold leading-relaxed">
                      ⚠️ Attention : Cette action est définitive. L'article sera supprimé de l'inventaire.
                    </p>
                  </div>

                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={() => setIsModalOpen(false)}
                      className="flex-1 p-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-sm transition-all"
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteItem(selectedItem.id)}
                      className="flex-1 p-4 bg-rose-600 hover:bg-rose-700 text-white rounded-2xl font-bold text-sm shadow-lg shadow-rose-950/20 transition-all"
                    >
                      Supprimer
                    </button>
                  </div>
                </div>
              )}
              {modalType === "changePassword" && (
                <ChangePasswordForm
                  currentPassword={dbPassword}
                  onSubmit={async (newPass) => {
                    try {
                      await setDoc(doc(db, "config", "app_lock"), {
                        password: newPass,
                      });
                      localStorage.setItem(
                        "stockpro_app_lock_password",
                        newPass,
                      );
                      setDbPassword(newPass);
                      setIsModalOpen(false);
                      // Use a clean visual notification rather than disturbing browser alerts where possible
                    } catch (err) {
                      console.error(err);
                      localStorage.setItem(
                        "stockpro_app_lock_password",
                        newPass,
                      );
                      setDbPassword(newPass);
                      setIsModalOpen(false);
                    }
                  }}
                  onCancel={() => setIsModalOpen(false)}
                />
              )}
              {modalType === "auth" && (
                <AuthModalForm onCancel={() => setIsModalOpen(false)} />
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 50 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 50 }}
            className="fixed bottom-8 right-8 z-[200] bg-slate-900 border border-slate-800 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 font-sans"
          >
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-black tracking-widest uppercase text-emerald-400 mr-1">
              INFO
            </span>
            <span className="text-xs font-black text-slate-100">
              {toastMessage}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Sub-components & Forms ---

function SidebarItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-4 rounded-2xl font-bold transition-all ${
        active
          ? "bg-slate-900 text-white shadow-xl shadow-slate-900/20"
          : "text-slate-400 hover:text-slate-900 hover:bg-slate-50"
      }`}
    >
      {icon}
      <span className="text-sm tracking-tight">{label}</span>
      {active && (
        <motion.div
          layoutId="pill"
          className="ml-auto w-1 h-1 bg-white rounded-full"
        />
      )}
    </button>
  );
}

function AddItemForm({
  initialCategory,
  onSubmit,
  onCancel,
}: {
  initialCategory?: Category;
  onSubmit: (
    data: Partial<InventoryItem>,
    extraTx?: {
      qteRecu?: number;
      dateRecu?: string;
      qteNombre?: number;
      dateSortie?: string;
      demandeSrh?: number;
      demandeSfc?: number;
      qteSrh?: number;
      qteSfc?: number;
      observation?: string;
    },
  ) => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState({
    nProduit: "",
    name: "",
    category: initialCategory || Category.STATIONERY,
    quantity: 0,
    unit: "Unité",
    minStock: 5,
    location: "",
  });

  const [extraTx, setExtraTx] = useState({
    qteRecu: 0,
    dateRecu: new Date().toISOString().split("T")[0],
    qteNombre: 0,
    dateSortie: new Date().toISOString().split("T")[0],
    demandeSrh: 0,
    demandeSfc: 0,
    qteSrh: 0,
    qteSfc: 0,
    observation: "",
  });

  return (
    <form
      className="space-y-6 flex flex-col h-full overflow-hidden"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(formData, extraTx);
      }}
    >
      <div className="flex justify-between items-center pb-3 border-b border-slate-100 mb-2">
        <div>
          <h3 className="text-2xl font-black tracking-tight text-slate-900">
            Nouvelle Fourniture
          </h3>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">
            Enregistrement d'article & initialisation stock
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-slate-300 hover:text-slate-950 transition-colors"
        >
          <XCircle size={24} />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 overflow-y-auto max-h-[60vh] pr-2">
        {/* Left Column: Product Information */}
        <div className="space-y-4">
          <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">
            Caractéristiques de l'article
          </h4>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">
              Désignation du produit
            </label>
            <input
              required
              className="w-full p-4 bg-slate-50 rounded-2xl border border-transparent outline-none focus:border-slate-300 focus:bg-white transition-all font-bold"
              placeholder="Ex: Rame de papier A4 80g"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">
                Référence / Code
              </label>
              <input
                required
                className="w-full p-4 bg-slate-50 rounded-2xl border border-transparent outline-none focus:border-slate-300 focus:bg-white transition-all font-bold uppercase tracking-widest"
                placeholder="PAP-001"
                value={formData.nProduit}
                onChange={(e) =>
                  setFormData({ ...formData, nProduit: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">
                Catégorie
              </label>
              <select
                className="w-full p-4 bg-slate-50 rounded-2xl border border-transparent outline-none focus:border-slate-300 focus:bg-white transition-all font-bold"
                value={formData.category}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    category: e.target.value as Category,
                  })
                }
              >
                {Object.values(Category).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">
                Stock Initial
              </label>
              <input
                type="number"
                required
                className="w-full p-4 bg-slate-50 rounded-2xl border border-transparent outline-none focus:border-slate-300 focus:bg-white transition-all font-bold text-center"
                value={formData.quantity}
                onChange={(e) =>
                  setFormData({ ...formData, quantity: Number(e.target.value) })
                }
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">
                Unité
              </label>
              <input
                className="w-full p-4 bg-slate-50 rounded-2xl border border-transparent outline-none focus:border-slate-300 focus:bg-white transition-all font-bold text-center"
                placeholder="Boite/Unité"
                value={formData.unit}
                onChange={(e) =>
                  setFormData({ ...formData, unit: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">
                Seuil Alerte
              </label>
              <input
                type="number"
                required
                className="w-full p-4 bg-slate-50 rounded-2xl border border-transparent outline-none focus:border-slate-300 focus:bg-white transition-all font-bold text-center"
                value={formData.minStock}
                onChange={(e) =>
                  setFormData({ ...formData, minStock: Number(e.target.value) })
                }
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">
              Emplacement (Dépôt/Rayon)
            </label>
            <input
              className="w-full p-4 bg-slate-50 rounded-2xl border border-transparent outline-none focus:border-slate-300 focus:bg-white transition-all font-bold"
              placeholder="Ex: Rayon A - Étagère 2"
              value={formData.location}
              onChange={(e) =>
                setFormData({ ...formData, location: e.target.value })
              }
            />
          </div>
        </div>

        {/* Right Column: Initial Movements (Flux DRH, SRH, SFC or Standard) */}
        <div className="space-y-4 lg:border-l lg:border-slate-100 lg:pl-8 animate-fade-in">
          <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">
            Mouvements & Flux initiaux
          </h4>

          {formData.category === Category.DRH && (
            <div className="grid grid-cols-1 gap-4 bg-slate-50/50 p-5 rounded-[2rem] border border-slate-100/50">
              {/* Reception (Incoming) block */}
              <div className="space-y-3 pb-3 border-b border-dashed border-slate-200">
                <span className="text-[9px] font-black uppercase text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded tracking-widest inline-block">
                  Entrée DRH (Réception)
                </span>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider block">
                      Quantité Reçu (DRH)
                    </label>
                    <input
                      type="number"
                      min="0"
                      className="w-full p-3 bg-white border border-slate-100 rounded-xl outline-none focus:border-slate-300 transition-all font-bold text-center text-slate-900"
                      value={extraTx.qteRecu}
                      onChange={(e) =>
                        setExtraTx({
                          ...extraTx,
                          qteRecu: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider block">
                      En Date
                    </label>
                    <input
                      type="date"
                      className="w-full p-3 bg-white border border-slate-100 rounded-xl outline-none focus:border-slate-300 transition-all font-bold text-center text-xs text-slate-900"
                      value={extraTx.dateRecu}
                      onChange={(e) =>
                        setExtraTx({ ...extraTx, dateRecu: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>

              {/* Initial Demands for SRH or SFC */}
              <div className="space-y-3 pt-1">
                <span className="text-[9px] font-black uppercase text-rose-600 bg-rose-50 px-2.5 py-1 rounded tracking-widest inline-block">
                  Demandes Initiales
                </span>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider block">
                      Demande SRH
                    </label>
                    <input
                      type="number"
                      min="0"
                      className="w-full p-3 bg-white border border-slate-100 rounded-xl outline-none focus:border-slate-300 transition-all font-bold text-center text-slate-900"
                      value={extraTx.demandeSrh}
                      onChange={(e) =>
                        setExtraTx({
                          ...extraTx,
                          demandeSrh: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider block">
                      Demande SFC
                    </label>
                    <input
                      type="number"
                      min="0"
                      className="w-full p-3 bg-white border border-slate-100 rounded-xl outline-none focus:border-slate-300 transition-all font-bold text-center text-slate-900"
                      value={extraTx.demandeSfc}
                      onChange={(e) =>
                        setExtraTx({
                          ...extraTx,
                          demandeSfc: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {formData.category === Category.SRH && (
            <div className="grid grid-cols-1 gap-4 bg-slate-50/50 p-5 rounded-[2rem] border border-slate-100/50">
              <div className="space-y-3 pb-3 border-b border-dashed border-slate-200">
                <span className="text-[9px] font-black uppercase text-rose-600 bg-rose-50 px-2.5 py-1 rounded tracking-widest inline-block">
                  Demande SRH (Flux initial)
                </span>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider block">
                      Quantité Demandée
                    </label>
                    <input
                      type="number"
                      min="0"
                      className="w-full p-3 bg-white border border-slate-100 rounded-xl outline-none focus:border-slate-300 transition-all font-bold text-center text-slate-900"
                      value={extraTx.demandeSrh}
                      onChange={(e) =>
                        setExtraTx({
                          ...extraTx,
                          demandeSrh: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider block">
                      Date de Demande
                    </label>
                    <input
                      type="date"
                      className="w-full p-3 bg-white border border-slate-100 rounded-xl outline-none focus:border-slate-300 transition-all font-bold text-center text-xs text-slate-900"
                      value={extraTx.dateSortie}
                      onChange={(e) =>
                        setExtraTx({ ...extraTx, dateSortie: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3 pt-1">
                <span className="text-[9px] font-black uppercase text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded tracking-widest inline-block">
                  Réception SRH (Flux initial)
                </span>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider block">
                      Quantité Reçu (SRH)
                    </label>
                    <input
                      type="number"
                      min="0"
                      className="w-full p-3 bg-white border border-slate-100 rounded-xl outline-none focus:border-slate-300 transition-all font-bold text-center text-slate-900"
                      value={extraTx.qteSrh}
                      onChange={(e) =>
                        setExtraTx({
                          ...extraTx,
                          qteSrh: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider block">
                      Recu Le
                    </label>
                    <input
                      type="date"
                      className="w-full p-3 bg-white border border-slate-100 rounded-xl outline-none focus:border-slate-300 transition-all font-bold text-center text-xs text-slate-900"
                      value={extraTx.dateRecu}
                      onChange={(e) =>
                        setExtraTx({ ...extraTx, dateRecu: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {formData.category === Category.SFC && (
            <div className="grid grid-cols-1 gap-4 bg-slate-50/50 p-5 rounded-[2rem] border border-slate-100/50">
              <div className="space-y-3 pb-3 border-b border-dashed border-slate-200">
                <span className="text-[9px] font-black uppercase text-rose-600 bg-rose-50 px-2.5 py-1 rounded tracking-widest inline-block">
                  Demande SFC (Flux initial)
                </span>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider block">
                      Quantité Demandée
                    </label>
                    <input
                      type="number"
                      min="0"
                      className="w-full p-3 bg-white border border-slate-100 rounded-xl outline-none focus:border-slate-300 transition-all font-bold text-center text-slate-900"
                      value={extraTx.demandeSfc}
                      onChange={(e) =>
                        setExtraTx({
                          ...extraTx,
                          demandeSfc: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider block">
                      Date de Demande
                    </label>
                    <input
                      type="date"
                      className="w-full p-3 bg-white border border-slate-100 rounded-xl outline-none focus:border-slate-300 transition-all font-bold text-center text-xs text-slate-900"
                      value={extraTx.dateSortie}
                      onChange={(e) =>
                        setExtraTx({ ...extraTx, dateSortie: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3 pt-1">
                <span className="text-[9px] font-black uppercase text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded tracking-widest inline-block">
                  Réception SFC (Flux initial)
                </span>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider block">
                      Quantité Reçu (SFC)
                    </label>
                    <input
                      type="number"
                      min="0"
                      className="w-full p-3 bg-white border border-slate-100 rounded-xl outline-none focus:border-slate-300 transition-all font-bold text-center text-slate-900"
                      value={extraTx.qteSfc}
                      onChange={(e) =>
                        setExtraTx({
                          ...extraTx,
                          qteSfc: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider block">
                      Recu Le
                    </label>
                    <input
                      type="date"
                      className="w-full p-3 bg-white border border-slate-100 rounded-xl outline-none focus:border-slate-300 transition-all font-bold text-center text-xs text-slate-900"
                      value={extraTx.dateRecu}
                      onChange={(e) =>
                        setExtraTx({ ...extraTx, dateRecu: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {![(Category.DRH as string), (Category.SRH as string), (Category.SFC as string)].includes(formData.category) && (
            <div className="grid grid-cols-1 gap-4 bg-slate-50/50 p-5 rounded-[2rem] border border-slate-100/50">
              {/* Reception (Incoming) block */}
              <div className="space-y-3 pb-3 border-b border-dashed border-slate-200">
                <span className="text-[9px] font-black uppercase text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded tracking-widest inline-block">
                  Entrée (Réception)
                </span>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block">
                      Quantité Reçu
                    </label>
                    <input
                      type="number"
                      className="w-full p-3 bg-white border border-slate-100 rounded-xl outline-none focus:border-slate-300 transition-all font-bold text-center"
                      value={extraTx.qteRecu}
                      onChange={(e) =>
                        setExtraTx({
                          ...extraTx,
                          qteRecu: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block">
                      En Date
                    </label>
                    <input
                      type="date"
                      className="w-full p-3 bg-white border border-slate-100 rounded-xl outline-none focus:border-slate-300 transition-all font-bold text-center text-xs"
                      value={extraTx.dateRecu}
                      onChange={(e) =>
                        setExtraTx({ ...extraTx, dateRecu: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>

              {/* Outgoing (Dotation/Qte Nombre) block */}
              <div className="space-y-3 pt-1">
                <span className="text-[9px] font-black uppercase text-rose-600 bg-rose-50 px-2.5 py-1 rounded tracking-widest inline-block">
                  Sortie (Dotation)
                </span>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block">
                      Quantité Demandée
                    </label>
                    <input
                      type="number"
                      className="w-full p-3 bg-white border border-slate-100 rounded-xl outline-none focus:border-slate-300 transition-all font-bold text-center"
                      value={extraTx.qteNombre}
                      onChange={(e) =>
                        setExtraTx({
                          ...extraTx,
                          qteNombre: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block">
                      Date
                    </label>
                    <input
                      type="date"
                      className="w-full p-3 bg-white border border-slate-100 rounded-xl outline-none focus:border-slate-300 transition-all font-bold text-center text-xs"
                      value={extraTx.dateSortie}
                      onChange={(e) =>
                        setExtraTx({ ...extraTx, dateSortie: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">
              Observation
            </label>
            <input
              className="w-full p-4 bg-slate-50 rounded-2xl border border-transparent outline-none focus:border-slate-300 focus:bg-white transition-all font-bold"
              placeholder="Notes, observations ou justifications..."
              value={extraTx.observation}
              onChange={(e) =>
                setExtraTx({ ...extraTx, observation: e.target.value })
              }
            />
          </div>
        </div>
      </div>

      <button
        type="submit"
        className="w-full py-5 bg-slate-900 hover:bg-slate-800 text-white rounded-3xl font-black uppercase tracking-widest shadow-xl shadow-slate-900/10 active:scale-[0.98] transition-all mt-4"
      >
        Enregistrer la fourniture
      </button>
    </form>
  );
}

function EditServiceSupplyForm({
  item,
  onSubmit,
  onCancel,
}: {
  item: InventoryItem;
  onSubmit: (updatedFields: Partial<InventoryItem>) => void;
  onCancel: () => void;
}) {
  const [qteRecuDRH, setQteRecuDRH] = useState(item.qteRecuDRH || 0);
  const [demandeSrh, setDemandeSrh] = useState(item.demandeSrh || 0);
  const [demandeSfc, setDemandeSfc] = useState(item.demandeSfc || 0);
  const [qteSrh, setQteSrh] = useState(item.qteSrh || 0);
  const [qteSfc, setQteSfc] = useState(item.qteSfc || 0);
  const [observation, setObservation] = useState(item.observation || "");

  const getTitle = () => {
    switch (item.category) {
      case Category.DRH:
        return "Remplir Fourniture DRH";
      case Category.SRH:
        return "Remplir Fourniture SRH";
      case Category.SFC:
        return "Remplir Fourniture SFC";
      default:
        return "Remplir Fourniture";
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (item.category === Category.DRH) {
      onSubmit({
        qteRecuDRH,
        observation,
      });
    } else if (item.category === Category.SRH) {
      onSubmit({
        demandeSrh,
        qteSrh,
        observation,
      });
    } else if (item.category === Category.SFC) {
      onSubmit({
        demandeSfc,
        qteSfc,
        observation,
      });
    }
  };

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="text-2xl font-black tracking-tight">{getTitle()}</h3>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
            {item.name} • {item.nProduit}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-slate-300 hover:text-slate-900 transition-all font-bold"
        >
          <XCircle />
        </button>
      </div>

      <div className="space-y-4">
        {item.category === Category.DRH && (
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
              Quantité Reçu (DRH)
            </label>
            <input
              type="number"
              min="0"
              className="w-full p-4 bg-slate-50 rounded-2xl border border-transparent outline-none focus:border-slate-300 focus:bg-white transition-all font-bold text-slate-900"
              value={qteRecuDRH}
              onChange={(e) => setQteRecuDRH(Number(e.target.value) || 0)}
              required
            />
          </div>
        )}

        {item.category === Category.SRH && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
                  Quantité Demandée (SRH)
                </label>
                <input
                  type="number"
                  min="0"
                  className="w-full p-4 bg-slate-50 rounded-2xl border border-transparent outline-none focus:border-slate-300 focus:bg-white transition-all font-bold text-slate-900"
                  value={demandeSrh}
                  onChange={(e) => setDemandeSrh(Number(e.target.value) || 0)}
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
                  Quantité Reçu (SRH)
                </label>
                <input
                  type="number"
                  min="0"
                  className="w-full p-4 bg-slate-50 rounded-2xl border border-transparent outline-none focus:border-slate-300 focus:bg-white transition-all font-bold text-slate-900"
                  value={qteSrh}
                  onChange={(e) => setQteSrh(Number(e.target.value) || 0)}
                  required
                />
              </div>
            </div>
          </>
        )}

        {item.category === Category.SFC && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
                  Quantité Demandée (SFC)
                </label>
                <input
                  type="number"
                  min="0"
                  className="w-full p-4 bg-slate-50 rounded-2xl border border-transparent outline-none focus:border-slate-300 focus:bg-white transition-all font-bold text-slate-900"
                  value={demandeSfc}
                  onChange={(e) => setDemandeSfc(Number(e.target.value) || 0)}
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
                  Quantité Reçu (SFC)
                </label>
                <input
                  type="number"
                  min="0"
                  className="w-full p-4 bg-slate-50 rounded-2xl border border-transparent outline-none focus:border-slate-300 focus:bg-white transition-all font-bold text-slate-900"
                  value={qteSfc}
                  onChange={(e) => setQteSfc(Number(e.target.value) || 0)}
                  required
                />
              </div>
            </div>
          </>
        )}

        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
            Observation
          </label>
          <textarea
            className="w-full p-4 bg-slate-50 rounded-2xl border border-transparent outline-none focus:border-slate-300 focus:bg-white transition-all font-bold min-h-[100px] text-slate-900"
            placeholder="Observations ou remarques sur cette prestation..."
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
          />
        </div>
      </div>

      <div className="pt-4 border-t border-slate-100 flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-black uppercase tracking-wider text-xs transition-all"
        >
          Annuler
        </button>
        <button
          type="submit"
          className="flex-1 py-4 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl font-black uppercase tracking-wider text-xs shadow-lg shadow-slate-900/10 transition-all hover:scale-[1.01] active:scale-[0.99]"
        >
          Sauvegarder
        </button>
      </div>
    </form>
  );
}

function UpdateStockForm({
  item,
  defaultType,
  onSubmit,
  onCancel,
}: {
  item: InventoryItem;
  defaultType?: TransactionType;
  onSubmit: (
    amount: number,
    type: TransactionType,
    designationPrestation: string,
    observation: string,
  ) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(1);
  const [type, setType] = useState<TransactionType>(
    defaultType || TransactionType.OUTGOING,
  );
  const [designationPrestation, setDesignationPrestation] = useState("");
  const [observation, setObservation] = useState("");

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(amount, type, designationPrestation, observation);
      }}
    >
      <div className="flex justify-between items-center mb-8">
        <div>
          <h3 className="text-2xl font-black tracking-tight">
            Mouvement Stock
          </h3>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
            {item.name} • Dispo: {item.quantity} {item.unit}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-slate-300 hover:text-slate-900"
        >
          <XCircle />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => setType(TransactionType.INCOMING)}
          className={`p-6 rounded-3xl border-2 transition-all flex flex-col items-center gap-2 group ${type === TransactionType.INCOMING ? "bg-emerald-50 border-emerald-500" : "bg-white border-slate-100 hover:border-emerald-200"}`}
        >
          <ArrowDownLeft
            size={32}
            className={
              type === TransactionType.INCOMING
                ? "text-emerald-500"
                : "text-slate-300"
            }
          />
          <span
            className={`text-[10px] font-black uppercase tracking-widest ${type === TransactionType.INCOMING ? "text-emerald-700" : "text-slate-400"}`}
          >
            Réception (Entrée)
          </span>
        </button>
        <button
          type="button"
          onClick={() => setType(TransactionType.OUTGOING)}
          className={`p-6 rounded-3xl border-2 transition-all flex flex-col items-center gap-2 group ${type === TransactionType.OUTGOING ? "bg-rose-50 border-rose-500" : "bg-white border-slate-100 hover:border-rose-200"}`}
        >
          <ArrowUpRight
            size={32}
            className={
              type === TransactionType.OUTGOING
                ? "text-rose-500"
                : "text-slate-300"
            }
          />
          <span
            className={`text-[10px] font-black uppercase tracking-widest ${type === TransactionType.OUTGOING ? "text-rose-700" : "text-slate-400"}`}
          >
            Dotation (Sortie)
          </span>
        </button>
      </div>

      <div className="space-y-4 pt-4 border-t border-slate-100">
        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
            Quantité
          </label>
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => setAmount(Math.max(1, amount - 1))}
              className="h-12 w-12 bg-slate-100 rounded-xl flex items-center justify-center font-black text-xl hover:bg-slate-200 transition-all"
            >
              -
            </button>
            <input
              type="number"
              className="flex-1 text-center bg-slate-50 p-4 rounded-2xl font-black text-2xl border-none outline-none focus:ring-2 focus:ring-slate-900"
              value={amount}
              readOnly
            />
            <button
              type="button"
              onClick={() => setAmount(amount + 1)}
              className="h-12 w-12 bg-slate-100 rounded-xl flex items-center justify-center font-black text-xl hover:bg-slate-200 transition-all"
            >
              +
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
            {type === TransactionType.OUTGOING
              ? "Service Bénéficiaire"
              : "Fournisseur / Source"}
          </label>
          <input
            required
            className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-slate-900 transition-all font-bold"
            placeholder={
              type === TransactionType.OUTGOING
                ? "Ex: Service RH / Ahmed"
                : "Ex: Librairie Centrale"
            }
            value={designationPrestation}
            onChange={(e) => setDesignationPrestation(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
            Observation
          </label>
          <input
            className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-slate-900 transition-all font-bold"
            placeholder="Notes éventuelles..."
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
          />
        </div>
      </div>

      <button
        type="submit"
        className={`w-full py-5 rounded-2xl font-black text-white shadow-xl transition-all active:scale-[0.98] ${type === TransactionType.INCOMING ? "bg-emerald-600 shadow-emerald-200" : "bg-rose-600 shadow-rose-200"}`}
      >
        Valider le mouvement
      </button>
    </form>
  );
}

function QuickMovementForm({
  items,
  defaultType,
  onSubmit,
  onCancel,
}: {
  items: InventoryItem[];
  defaultType: TransactionType;
  onSubmit: (
    itemId: string,
    amount: number,
    type: TransactionType,
    designationPrestation: string,
    observation: string,
  ) => void;
  onCancel: () => void;
}) {
  const [selectedItemId, setSelectedItemId] = useState("");
  const [amount, setAmount] = useState(1);
  const [type, setType] = useState<TransactionType>(defaultType);
  const [designationPrestation, setDesignationPrestation] = useState("");
  const [observation, setObservation] = useState("");

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(
          selectedItemId,
          amount,
          type,
          designationPrestation,
          observation,
        );
      }}
    >
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-2xl font-black tracking-tight">
            Nouveau Mouvement
          </h3>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
            Fournitures de bureau
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-slate-300 hover:text-slate-900"
        >
          <XCircle />
        </button>
      </div>

      <div className="flex gap-2 bg-slate-100 p-1.5 rounded-2xl w-full">
        <button
          type="button"
          onClick={() => setType(TransactionType.INCOMING)}
          className={`flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 ${type === TransactionType.INCOMING ? "bg-emerald-600 text-white shadow-md" : "text-slate-500 hover:text-slate-950"}`}
        >
          📥 Entrée Stock
        </button>
        <button
          type="button"
          onClick={() => setType(TransactionType.OUTGOING)}
          className={`flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 ${type === TransactionType.OUTGOING ? "bg-rose-600 text-white shadow-md" : "text-slate-500 hover:text-slate-950"}`}
        >
          📤 Sortie Stock
        </button>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
            Fourniture / Article
          </label>
          <select
            required
            className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-slate-900 transition-all font-bold"
            value={selectedItemId}
            onChange={(e) => setSelectedItemId(e.target.value)}
          >
            <option value="">Choisir un article...</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.nProduit}) - Dispo: {item.quantity}{" "}
                {item.unit}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
            Quantité
          </label>
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => setAmount(Math.max(1, amount - 1))}
              className="h-12 w-12 bg-slate-100 rounded-xl flex items-center justify-center font-black text-xl hover:bg-slate-200 transition-all"
            >
              -
            </button>
            <input
              type="number"
              className="flex-1 text-center bg-slate-50 p-4 rounded-2xl font-black text-2xl border-none outline-none focus:ring-2 focus:ring-slate-900"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
            <button
              type="button"
              onClick={() => setAmount(amount + 1)}
              className="h-12 w-12 bg-slate-100 rounded-xl flex items-center justify-center font-black text-xl hover:bg-slate-200 transition-all"
            >
              +
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
            {type === TransactionType.OUTGOING
              ? "Service Bénéficiaire"
              : "Fournisseur"}
          </label>
          <input
            required
            className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-slate-900 transition-all font-bold"
            placeholder={
              type === TransactionType.OUTGOING
                ? "Ex: Service Comptabilité"
                : "Ex: Bureau Top"
            }
            value={designationPrestation}
            onChange={(e) => setDesignationPrestation(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
            Observation
          </label>
          <input
            className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-slate-900 transition-all font-bold"
            placeholder="Notes éventuelles..."
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={!selectedItemId}
        className={`w-full py-5 rounded-2xl font-black text-white shadow-xl transition-all active:scale-[0.98] disabled:opacity-50 ${
          type === TransactionType.INCOMING
            ? "bg-emerald-600 shadow-emerald-200"
            : "bg-rose-600 shadow-rose-200"
        }`}
      >
        Confirmer le mouvement
      </button>
    </form>
  );
}

function CreateSupplyRequestForm({
  items,
  onSubmit,
  onCancel,
}: {
  items: InventoryItem[];
  onSubmit: (data: {
    itemId: string;
    requestedQuantity: number;
    requesterName: string;
    requesterDepartment: Category;
    observation?: string;
  }) => void;
  onCancel: () => void;
}) {
  const [itemId, setItemId] = useState("");
  const [requestedQuantity, setRequestedQuantity] = useState(1);
  const [requesterName, setRequesterName] = useState("");
  const [requesterDepartment, setRequesterDepartment] = useState<Category>(
    Category.DRH,
  );
  const [observation, setObservation] = useState("");

  const selectedItem = items.find((it) => it.id === itemId);
  const maxAllowedQuantity = selectedItem ? selectedItem.quantity : 999999;

  const handleItemChange = (id: string) => {
    setItemId(id);
    const item = items.find((it) => it.id === id);
    if (item) {
      if (requestedQuantity > item.quantity) {
        setRequestedQuantity(Math.max(1, item.quantity));
      }
    }
  };

  const handleQuantityChange = (val: number) => {
    const capped = Math.min(maxAllowedQuantity, Math.max(1, val));
    setRequestedQuantity(capped);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedItem && requestedQuantity > selectedItem.quantity) {
      alert(
        `Erreur: La quantité demandée dépasse le stock disponible (${selectedItem.quantity} max).`,
      );
      return;
    }
    onSubmit({
      itemId,
      requestedQuantity,
      requesterName,
      requesterDepartment,
      observation,
    });
  };

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-2xl font-black tracking-tight text-slate-900">
            Nouvelle Demande
          </h3>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
            Dépôt d'une demande de fourniture
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-slate-300 hover:text-slate-900"
        >
          <XCircle size={24} />
        </button>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
            Fourniture / Article demandé
          </label>
          <select
            required
            className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-slate-900 transition-all font-bold"
            value={itemId}
            onChange={(e) => handleItemChange(e.target.value)}
          >
            <option value="">Choisir un article...</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.nProduit}) - Stock: {item.quantity}{" "}
                {item.unit}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
              Service Émetteur
            </label>
            <select
              required
              className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-slate-900 transition-all font-bold"
              value={requesterDepartment}
              onChange={(e) =>
                setRequesterDepartment(e.target.value as Category)
              }
            >
              <option value={Category.DRH}>DRH</option>
              <option value={Category.SRH}>SRH</option>
              <option value={Category.SFC}>SFC</option>
              <option value={Category.OTHER}>AUTRE / AUTRES SERVICES</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
              Nom du Demandeur
            </label>
            <input
              required
              className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-slate-900 transition-all font-medium text-sm"
              placeholder="Ex: Ahmed Alami"
              value={requesterName}
              onChange={(e) => setRequesterName(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1 flex justify-between">
            <span>Quantité Demandée</span>
            {selectedItem && (
              <span className="text-emerald-700 font-extrabold normal-case">
                Maximum disponible: {maxAllowedQuantity}
              </span>
            )}
          </label>
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => handleQuantityChange(requestedQuantity - 1)}
              className="h-12 w-12 bg-slate-100 rounded-xl flex items-center justify-center font-black text-xl hover:bg-slate-200 transition-all"
            >
              -
            </button>
            <input
              type="number"
              className="flex-1 text-center bg-slate-50 p-4 rounded-2xl font-black text-2xl border-none outline-none focus:ring-2 focus:ring-slate-900"
              value={requestedQuantity}
              onChange={(e) => handleQuantityChange(Number(e.target.value))}
              min={1}
              max={maxAllowedQuantity}
            />
            <button
              type="button"
              onClick={() => handleQuantityChange(requestedQuantity + 1)}
              className="h-12 w-12 bg-slate-100 rounded-xl flex items-center justify-center font-black text-xl hover:bg-slate-200 transition-all"
            >
              +
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
            Observation / Justification
          </label>
          <input
            className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-slate-900 transition-all font-semibold"
            placeholder="Notes complémentaires ou justification..."
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={!itemId || !requesterName.trim()}
        className="w-full py-5 rounded-2xl font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-200 transition-all active:scale-[0.98] disabled:opacity-50"
      >
        Soumettre la demande
      </button>
    </form>
  );
}

function ValidateSupplyRequestForm({
  request,
  items,
  onSubmit,
  onCancel,
}: {
  request: SupplyRequest;
  items: InventoryItem[];
  onSubmit: (
    status: "APPROVED" | "REJECTED",
    validatedQuantity?: number,
    observation?: string,
  ) => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState<"APPROVED" | "REJECTED">("APPROVED");
  const [validatedQuantity, setValidatedQuantity] = useState(
    request.requestedQuantity,
  );
  const [observation, setObservation] = useState("");

  const itemOfRequest = items.find((it) => it.id === request.itemId);
  const maxAllowed = itemOfRequest ? itemOfRequest.quantity : 999999;

  useEffect(() => {
    if (status === "APPROVED" && validatedQuantity > maxAllowed) {
      setValidatedQuantity(Math.max(1, maxAllowed));
    }
  }, [status, maxAllowed]);

  const handleValChange = (val: number) => {
    const capped = Math.min(maxAllowed, Math.max(1, val));
    setValidatedQuantity(capped);
  };

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "APPROVED" && validatedQuantity > maxAllowed) {
      alert(
        `Erreur: La quantité attribuée dépasse le stock disponible (${maxAllowed} max).`,
      );
      return;
    }
    onSubmit(
      status,
      status === "APPROVED" ? validatedQuantity : undefined,
      observation,
    );
  };

  return (
    <form className="space-y-6" onSubmit={handleSubmitForm}>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-2xl font-black tracking-tight text-slate-900 font-sans">
            Validation de Demande
          </h3>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1 animate-fade-in">
            Par: {request.requesterName} ({request.requesterDepartment})
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-slate-300 hover:text-slate-900"
        >
          <XCircle size={24} />
        </button>
      </div>

      <div className="space-y-4">
        <div className="p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100/50 space-y-2">
          <span className="text-[10px] font-black uppercase text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded tracking-wider">
            Article Demandé
          </span>
          <p className="text-lg font-black text-slate-800">
            {request.itemName}
          </p>
          <div className="flex justify-between text-xs font-bold text-slate-500 mt-1 flex-wrap gap-2">
            <span>Qté demandée: {request.requestedQuantity} unités</span>
            <span>Stock physique actuel: {maxAllowed}</span>
            <span>Catégorie: {request.itemCategory}</span>
          </div>
          {request.observation && (
            <p className="text-xs text-slate-400 italic mt-2 border-t border-dashed border-slate-200 pt-2">
              Motivation: "{request.observation}"
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => {
              setStatus("APPROVED");
              setValidatedQuantity(
                Math.min(request.requestedQuantity, maxAllowed),
              );
            }}
            className={`p-4 rounded-3xl border-2 transition-all flex flex-col items-center gap-1.5 group ${status === "APPROVED" ? "bg-emerald-50 border-emerald-500" : "bg-slate-50 border-slate-100 hover:border-emerald-200"}`}
          >
            <CheckCircle2
              size={24}
              className={
                status === "APPROVED" ? "text-emerald-500" : "text-slate-300"
              }
            />
            <span
              className={`text-[10px] font-black uppercase tracking-widest ${status === "APPROVED" ? "text-emerald-700" : "text-slate-400"}`}
            >
              Approuver
            </span>
          </button>
          <button
            type="button"
            onClick={() => setStatus("REJECTED")}
            className={`p-4 rounded-3xl border-2 transition-all flex flex-col items-center gap-1.5 group ${status === "REJECTED" ? "bg-rose-50 border-rose-500" : "bg-slate-50 border-slate-100 hover:border-rose-200"}`}
          >
            <XCircle
              size={24}
              className={
                status === "REJECTED" ? "text-rose-500" : "text-slate-300"
              }
            />
            <span
              className={`text-[10px] font-black uppercase tracking-widest ${status === "REJECTED" ? "text-rose-700" : "text-slate-400"}`}
            >
              Rejeter
            </span>
          </button>
        </div>

        {status === "APPROVED" && (
          <div className="space-y-2 animate-fade-in animate-duration-200">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1 flex justify-between">
              <span>Quantité Attribuée / Perçue</span>
              <span className="text-emerald-700 font-extrabold normal-case">
                Dispo réel: {maxAllowed}
              </span>
            </label>
            <div className="flex items-center gap-6">
              <button
                type="button"
                onClick={() => handleValChange(validatedQuantity - 1)}
                className="h-12 w-12 bg-slate-100 rounded-xl flex items-center justify-center font-black text-xl hover:bg-slate-200 transition-all"
              >
                -
              </button>
              <input
                type="number"
                className="flex-1 text-center bg-slate-50 p-4 rounded-2xl font-black text-2xl border-none outline-none focus:ring-2 focus:ring-slate-900"
                value={validatedQuantity}
                onChange={(e) => handleValChange(Number(e.target.value))}
                min={1}
                max={maxAllowed}
              />
              <button
                type="button"
                onClick={() => handleValChange(validatedQuantity + 1)}
                className="h-12 w-12 bg-slate-100 rounded-xl flex items-center justify-center font-black text-xl hover:bg-slate-200 transition-all"
              >
                +
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
            Observation / Motif
          </label>
          <input
            className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-slate-900 transition-all font-semibold"
            placeholder={
              status === "APPROVED"
                ? "Ex: Livré par lot complet"
                : "Ex: Non justifié / budget épuisé"
            }
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
          />
        </div>
      </div>

      <button
        type="submit"
        className={`w-full py-5 rounded-2xl font-black text-white shadow-xl transition-all active:scale-[0.98] ${
          status === "APPROVED"
            ? "bg-emerald-600 shadow-emerald-200"
            : "bg-rose-600 shadow-rose-200"
        }`}
      >
        Valider la décision
      </button>
    </form>
  );
}

function ChangePasswordForm({
  currentPassword,
  onSubmit,
  onCancel,
}: {
  currentPassword?: string;
  onSubmit: (newPassword: string) => void;
  onCancel: () => void;
}) {
  const [oldPass, setOldPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (currentPassword && oldPass !== currentPassword) {
      setError("L'ancien mot de passe est incorrect.");
      return;
    }

    if (newPass.length < 4) {
      setError("Le nouveau mot de passe doit contenir au moins 4 caractères.");
      return;
    }

    if (newPass !== confirmPass) {
      setError("La confirmation du nouveau mot de passe ne correspond pas.");
      return;
    }

    // Success
    setSuccess(true);
    setTimeout(() => {
      onSubmit(newPass);
    }, 800);
  };

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-2xl font-black tracking-tight text-slate-900">
            Sécurité
          </h3>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
            Modifier le code d'accès
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-slate-300 hover:text-slate-900"
        >
          <XCircle size={24} />
        </button>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-100 rounded-2xl text-rose-600 text-xs font-bold text-center">
          {error}
        </div>
      )}

      {success && (
        <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl text-emerald-600 text-xs font-bold text-center">
          ✓ Code d'accès mis à jour avec succès !
        </div>
      )}

      <div className="space-y-4">
        {currentPassword && (
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
              Code d'accès actuel
            </label>
            <input
              type="password"
              required
              className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-slate-900 transition-all font-semibold"
              placeholder="Saisir le code d'accès actuel"
              value={oldPass}
              onChange={(e) => {
                setOldPass(e.target.value);
                setError("");
              }}
            />
          </div>
        )}

        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
            Nouveau code d'accès
          </label>
          <div className="relative">
            <input
              type={showPass ? "text" : "password"}
              required
              className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-slate-900 transition-all font-semibold"
              placeholder="Entrer le nouveau code d'accès"
              value={newPass}
              onChange={(e) => {
                setNewPass(e.target.value);
                setError("");
              }}
            />
            <button
              type="button"
              onClick={() => setShowPass(!showPass)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900"
            >
              {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
            Confirmer le nouveau code d'accès
          </label>
          <input
            type="password"
            required
            className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-slate-900 transition-all font-semibold"
            placeholder="Confirmer le nouveau code"
            value={confirmPass}
            onChange={(e) => {
              setConfirmPass(e.target.value);
              setError("");
            }}
          />
        </div>
      </div>

      <button
        type="submit"
        className="w-full py-5 rounded-2xl font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-150 transition-all active:scale-[0.98]"
      >
        Sauvegarder le nouveau code
      </button>
    </form>
  );
}

interface AuthModalFormProps {
  onCancel: () => void;
}

function AuthModalForm({ onCancel }: AuthModalFormProps) {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      if (tab === "register") {
        if (!name.trim()) {
          throw new Error("Veuillez entrer votre nom complet.");
        }
        if (password.length < 6) {
          throw new Error("Le mot de passe doit contenir au moins 6 caractères.");
        }
        const userCredential = await registerWithEmail(email, password);
        if (userCredential.user) {
          await updateProfile(userCredential.user, {
            displayName: name,
          });
        }
        setSuccess("Votre compte a été créé avec succès !");
        setTimeout(() => {
          onCancel();
        }, 1200);
      } else {
        await loginWithEmail(email, password);
        setSuccess("Connexion réussie !");
        setTimeout(() => {
          onCancel();
        }, 800);
      }
    } catch (err) {
      console.error(err);
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("auth/weak-password")) {
        setError("Le mot de passe doit contenir au moins 6 caractères.");
      } else if (errMsg.includes("auth/email-already-in-use")) {
        setError("Cette adresse e-mail est déjà associée à un compte.");
      } else if (errMsg.includes("auth/invalid-credential") || errMsg.includes("auth/wrong-password") || errMsg.includes("auth/user-not-found")) {
        setError("Adresse e-mail ou mot de passe incorrect.");
      } else if (errMsg.includes("auth/invalid-email")) {
        setError("L'adresse e-mail n'est pas valide.");
      } else {
        setError(errMsg.replace("Firebase: ", ""));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      await loginWithGoogle();
      setSuccess("Connexion via Google réussie !");
      setTimeout(() => {
        onCancel();
      }, 800);
    } catch (err) {
      console.error(err);
      setError("La connexion via Google a échoué.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-2">
        <div>
          <h3 className="text-2xl font-black tracking-tight text-slate-900">
            {tab === "login" ? "Connexion" : "Créer un compte"}
          </h3>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
            {tab === "login" ? "Accéder à l'espace d'administration" : "Inscrire un nouvel administrateur"}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-slate-300 hover:text-slate-900 transition-colors"
        >
          <XCircle size={24} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-150 p-1.5 rounded-2xl gap-1">
        <button
          type="button"
          onClick={() => {
            setTab("login");
            setError("");
          }}
          className={`flex-1 py-3 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
            tab === "login"
              ? "bg-white text-slate-900 shadow-md"
              : "text-slate-500 hover:text-slate-900"
          }`}
        >
          Se Connecter
        </button>
        <button
          type="button"
          onClick={() => {
            setTab("register");
            setError("");
          }}
          className={`flex-1 py-3 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
            tab === "register"
              ? "bg-white text-slate-900 shadow-md"
              : "text-slate-500 hover:text-slate-900"
          }`}
        >
          S'inscrire
        </button>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl text-rose-600 text-xs font-bold flex items-center justify-center gap-2">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {success && (
        <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl text-emerald-600 text-xs font-bold text-center">
          {success}
        </div>
      )}

      <form className="space-y-4" onSubmit={handleSubmit}>
        {tab === "register" && (
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
              Nom Complet
            </label>
            <input
              type="text"
              required
              disabled={loading}
              className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-150 outline-none focus:ring-2 focus:ring-indigo-600 transition-all font-semibold"
              placeholder="Ex: Ahmed Alaoui"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
            Adresse E-mail
          </label>
          <input
            type="email"
            required
            disabled={loading}
            className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-150 outline-none focus:ring-2 focus:ring-indigo-600 transition-all font-semibold"
            placeholder="Ex: admin@stockpro.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError("");
            }}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
            Mot de passe
          </label>
          <div className="relative">
            <input
              type={showPass ? "text" : "password"}
              required
              disabled={loading}
              className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-150 outline-none focus:ring-2 focus:ring-indigo-600 transition-all font-semibold pr-12"
              placeholder="••••••••"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
            />
            <button
              type="button"
              onClick={() => setShowPass(!showPass)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900 transition-colors"
            >
              {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-4.5 rounded-2xl font-black text-xs uppercase tracking-wider text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-150 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? "Chargement..." : tab === "login" ? "Se Connecter" : "Créer le compte"}
        </button>
      </form>

      {/* Divider */}
      <div className="relative flex py-2 items-center">
        <div className="flex-grow border-t border-slate-200"></div>
        <span className="flex-shrink mx-4 text-[10px] font-black text-slate-400 uppercase tracking-wider">OU CONTINUER EN UN CLIC</span>
        <div className="flex-grow border-t border-slate-200"></div>
      </div>

      <button
        type="button"
        disabled={loading}
        onClick={handleGoogleLogin}
        className="w-full py-4.5 rounded-2xl border-none outline-none font-bold text-sm bg-slate-900 hover:bg-slate-800 text-white shadow-md active:scale-[0.98] transition-all flex items-center justify-center gap-3"
      >
        <svg className="h-5 w-5 mr-1" viewBox="0 0 24 24" width="24" height="24">
          <g transform="matrix(1, 0, 0, 1, 0, 0)">
            <path d="M21.35,11.1H12v2.7h5.38C17.11,15.22,15.2,16.5,12,16.5c-3.03,0-5.6-2.25-6.52-5.27c-0.23-0.69-0.38-1.42-0.38-2.23c0-0.81,0.15-1.54,0.38-2.23C6.4,3.75,8.97,1.5,12,1.5c1.64,0,3.13,0.59,4.3,1.59l2.84-2.84C17.3,0.1,14.83,0,12,0C7.38,0,3.46,2.83,1.86,6.93c-0.4,1.01-0.62,2.11-0.62,3.27c0,1.16,0.22,2.26,0.62,3.27C3.46,21.17,7.38,24,12,24c4.8,0,8.73-3.6,9.58-8.27C21.84,14.28,21.9,12.72,21.35,11.1z" fill="currentColor" />
          </g>
        </svg>
        Connexion avec Google
      </button>
    </div>
  );
}
