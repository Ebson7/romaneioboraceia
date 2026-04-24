import { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  getDocs, 
  orderBy, 
  setDoc,
  getDoc,
  serverTimestamp,
  Timestamp,
  writeBatch
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';

export interface Order {
  id: string;
  orderNumber: string;
  separator: string;
  collaborators: string[];
  startTime: Date;
  endTime: Date | null;
  status: 'na_fila' | 'separando' | 'finalizado';
  date: string;
  porFora: boolean;
}

export const useOrders = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [dailyTotal, setDailyTotal] = useState(0);
  const [dailyOrdersCount, setDailyOrdersCount] = useState(0);
  const [dailyOrdersOutside, setDailyOrdersOutside] = useState(0);
  const [romaneioStartTime, setRomaneioStartTime] = useState<string | null>(null);
  const [romaneioEndTime, setRomaneioEndTime] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    today.setHours(today.getHours() - 3);
    return today.toISOString().split('T')[0];
  });
  const [separators, setSeparators] = useState<string[]>([]);
  const { isAuthenticated, user } = useAuth();

  // Carregar separadores do banco
  useEffect(() => {
    const q = query(collection(db, 'separadores'), orderBy('nome'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sepList = snapshot.docs.map(doc => doc.data().nome as string);
      setSeparators(sepList);
    });

    return () => unsubscribe();
  }, []);

  // Carregar pedidos do banco
  useEffect(() => {
    const q = query(
      collection(db, 'pedidos'), 
      where('data', '==', selectedDate),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const ordersData = await Promise.all(
        snapshot.docs.map(async (pedidoDoc) => {
          const data = pedidoDoc.data();
          
          // Buscar colaboradores (subcoleção)
          const colabSnap = await getDocs(collection(db, `pedidos/${pedidoDoc.id}/colaboradores`));
          const collaborators = colabSnap.docs.map(d => d.data().nome as string);

          return {
            id: pedidoDoc.id,
            orderNumber: data.numero_pedido,
            separator: data.separador,
            collaborators,
            startTime: (data.hora_inicio as Timestamp).toDate(),
            endTime: data.hora_fim ? (data.hora_fim as Timestamp).toDate() : null,
            status: data.status,
            date: data.data,
            porFora: data.por_fora || false,
          } as Order;
        })
      );

      setOrders(ordersData);
    });

    return () => unsubscribe();
  }, [selectedDate]);

  // Carregar configuração do dia
  useEffect(() => {
    const configDocRef = doc(db, 'configuracao', selectedDate);
    
    const unsubscribe = onSnapshot(configDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setDailyTotal(data.total_folhas_dia || 0);
        setDailyOrdersCount(data.total_pedidos_dia || 0);
        setDailyOrdersOutside(data.total_pedidos_fora || 0);
        setRomaneioStartTime(data.hora_inicio_romaneio || null);
        setRomaneioEndTime(data.hora_fim_romaneio || null);
      } else {
        setDailyTotal(0);
        setDailyOrdersCount(0);
        setDailyOrdersOutside(0);
        setRomaneioStartTime(null);
        setRomaneioEndTime(null);
      }
    });

    return () => unsubscribe();
  }, [selectedDate]);

  const addOrder = async (
    orderNumber: string,
    separator: string,
    porFora: boolean = false
  ): Promise<{ success: boolean; error?: string }> => {
    if (!isAuthenticated) return { success: false, error: 'Não autenticado' };

    const existing = orders.find(o => o.orderNumber === orderNumber);
    if (existing) return { success: false, error: 'Esta folha já foi adicionada' };

    if (!porFora) {
      const separatorInProgress = orders.find(o => o.separator === separator && o.status === 'separando' && !o.porFora);
      if (separatorInProgress) {
        return { success: false, error: `${separator} já está separando a folha ${separatorInProgress.orderNumber}` };
      }
    }

    try {
      await addDoc(collection(db, 'pedidos'), {
        numero_pedido: orderNumber,
        separador: separator,
        status: porFora ? 'finalizado' : 'separando',
        data: selectedDate,
        por_fora: porFora,
        hora_inicio: serverTimestamp(),
        hora_fim: porFora ? serverTimestamp() : null,
        createdAt: serverTimestamp(),
        createdBy: user?.uid
      });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  };

  const finishOrder = async (orderId: string): Promise<boolean> => {
    if (!isAuthenticated) return false;

    try {
      await updateDoc(doc(db, 'pedidos', orderId), {
        hora_fim: serverTimestamp(),
        status: 'finalizado',
      });
      return true;
    } catch (error) {
      return false;
    }
  };

  const removeOrder = async (orderId: string): Promise<void> => {
    if (!isAuthenticated) return;
    await deleteDoc(doc(db, 'pedidos', orderId));
  };

  const clearAllOrders = async (): Promise<void> => {
    if (!isAuthenticated) return;
    
    const batch = writeBatch(db);
    const q = query(collection(db, 'pedidos'), where('data', '==', selectedDate));
    const snapshot = await getDocs(q);
    
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();
  };

  const getStats = () => {
    const todayOrders = orders;
    const total = todayOrders.length;
    const inProgress = todayOrders.filter(o => o.status === 'separando').length;
    const completed = todayOrders.filter(o => o.status === 'finalizado').length;
    const progressPercentage = dailyTotal > 0 ? Math.round((completed / dailyTotal) * 100) : 0;
    
    const finishedOrders = todayOrders.filter(o => o.status === 'finalizado' && !o.porFora);
    let avgTime = 0;
    
    if (finishedOrders.length > 0) {
      const totalTime = finishedOrders.reduce((sum, order) => {
        return sum + (order.endTime!.getTime() - order.startTime.getTime());
      }, 0);
      avgTime = Math.round(totalTime / finishedOrders.length / (1000 * 60));
    }

    return { total, inProgress, completed, avgTime, progressPercentage, dailyTotal };
  };

  const getSeparatorStats = () => {
    const finishedOrders = orders.filter(o => o.status === 'finalizado');
    const statsMap = new Map<string, number>();
    
    finishedOrders.forEach(order => {
      const current = statsMap.get(order.separator) || 0;
      statsMap.set(order.separator, current + 1);
    });
    
    return Array.from(statsMap.entries()).map(([name, completed]) => ({
      name,
      completed,
    }));
  };

  const getUniqueSeparatorsCount = () => {
    const activeSeparators = new Set<string>();
    orders.forEach(order => {
      activeSeparators.add(order.separator);
      order.collaborators.forEach(c => activeSeparators.add(c));
    });
    return activeSeparators.size;
  };

  const getBusySeparators = () => {
    return orders
      .filter(o => o.status === 'separando')
      .map(o => ({ name: o.separator, orderNumber: o.orderNumber }));
  };

  const exportToCsv = (): string => {
    const totalPedidos = dailyOrdersCount + dailyOrdersOutside;
    // Cabeçalho com informações do dia
    const summaryHeaders = ['Resumo do Dia'];
    const summaryRows = [
      ['Data', selectedDate],
      ['Total de Folhas do Dia', dailyTotal.toString()],
      ['Pedidos do Dia', dailyOrdersCount.toString()],
      ['Pedidos por Fora', dailyOrdersOutside.toString()],
      ['Total de Pedidos', totalPedidos.toString()],
      ['Início do Romaneio', romaneioStartTime || 'Não definido'],
      ['Fim do Romaneio', romaneioEndTime || 'Não definido'],
      [''],
    ];

    const headers = ['Data', 'Número da Folha', 'Separador Principal', 'Colaboradores', 'Hora Início', 'Hora Fim', 'Tempo Separação', 'Status', 'Origem'];
    
    const rows = orders.map(order => [
      order.date,
      order.orderNumber,
      order.separator,
      order.collaborators.join('; '),
      order.startTime.toLocaleTimeString('pt-BR'),
      order.endTime ? order.endTime.toLocaleTimeString('pt-BR') : '',
      order.endTime 
        ? `${Math.floor((order.endTime.getTime() - order.startTime.getTime()) / (1000 * 60))}m ${Math.floor(((order.endTime.getTime() - order.startTime.getTime()) % (1000 * 60)) / 1000)}s`
        : '',
      order.status === 'separando' ? 'Em Separação' : 'Finalizado',
      order.porFora ? 'Por Fora' : 'Romaneio'
    ]);

    const summarySection = [summaryHeaders, ...summaryRows].map(row => row.join(',')).join('\n');
    const ordersSection = [headers, ...rows].map(row => row.join(',')).join('\n');

    return `${summarySection}\n${ordersSection}`;
  };

  const addSeparator = async (name: string): Promise<boolean> => {
    if (!isAuthenticated) return false;
    const trimmedName = name.trim();
    if (separators.includes(trimmedName)) return false;

    try {
      await addDoc(collection(db, 'separadores'), {
        nome: trimmedName,
        createdAt: serverTimestamp()
      });
      return true;
    } catch (error) {
      return false;
    }
  };

  const removeSeparator = async (name: string): Promise<void> => {
    if (!isAuthenticated) return;

    const q = query(collection(db, 'separadores'), where('nome', '==', name));
    const snapshot = await getDocs(q);
    const batch = writeBatch(db);
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  };

  const updateOrderSeparator = async (orderId: string, newSeparator: string): Promise<boolean> => {
    if (!isAuthenticated) return false;

    try {
      await updateDoc(doc(db, 'pedidos', orderId), {
        separador: newSeparator
      });
      return true;
    } catch (error) {
      return false;
    }
  };

  const addCollaborators = async (orderId: string, collaboratorNames: string[]): Promise<boolean> => {
    if (!isAuthenticated) return false;

    const order = orders.find(o => o.id === orderId);
    if (!order || order.status !== 'separando') return false;

    const newCollaborators = collaboratorNames.filter(name => 
      !order.collaborators.includes(name) && name !== order.separator
    );
    
    if (newCollaborators.length === 0) return false;

    try {
      const batch = writeBatch(db);
      newCollaborators.forEach(name => {
        const colabRef = doc(collection(db, `pedidos/${orderId}/colaboradores`));
        batch.set(colabRef, { 
          nome: name,
          addedAt: serverTimestamp()
        });
      });
      await batch.commit();
      return true;
    } catch (error) {
      return false;
    }
  };

  const removeCollaborator = async (orderId: string, collaboratorName: string): Promise<boolean> => {
    if (!isAuthenticated) return false;

    const q = query(
      collection(db, `pedidos/${orderId}/colaboradores`), 
      where('nome', '==', collaboratorName)
    );
    const snapshot = await getDocs(q);
    const batch = writeBatch(db);
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    return true;
  };

  const updateDailyTotal = async (total: number): Promise<void> => {
    if (!isAuthenticated) return;
    await setDoc(doc(db, 'configuracao', selectedDate), { total_folhas_dia: total }, { merge: true });
    setDailyTotal(total);
  };

  const updateDailyOrdersCount = async (count: number): Promise<void> => {
    if (!isAuthenticated) return;
    await setDoc(doc(db, 'configuracao', selectedDate), { total_pedidos_dia: count }, { merge: true });
    setDailyOrdersCount(count);
  };

  const updateDailyOrdersOutside = async (count: number): Promise<void> => {
    if (!isAuthenticated) return;
    await setDoc(doc(db, 'configuracao', selectedDate), { total_pedidos_fora: count }, { merge: true });
    setDailyOrdersOutside(count);
  };

  const getTodayOrders = () => {
    return orders;
  };

  const updateRomaneioStartTime = async (time: string | null): Promise<void> => {
    if (!isAuthenticated) return;
    await setDoc(doc(db, 'configuracao', selectedDate), { hora_inicio_romaneio: time }, { merge: true });
    setRomaneioStartTime(time);
  };

  const updateRomaneioEndTime = async (time: string | null): Promise<void> => {
    if (!isAuthenticated) return;
    await setDoc(doc(db, 'configuracao', selectedDate), { hora_fim_romaneio: time }, { merge: true });
    setRomaneioEndTime(time);
  };

  return {
    orders: getTodayOrders(),
    allOrders: orders,
    addOrder,
    finishOrder,
    removeOrder,
    clearAllOrders,
    getStats,
    getSeparatorStats,
    getUniqueSeparatorsCount,
    getBusySeparators,
    exportToCsv,
    dailyTotal,
    setDailyTotal: updateDailyTotal,
    dailyOrdersCount,
    setDailyOrdersCount: updateDailyOrdersCount,
    dailyOrdersOutside,
    setDailyOrdersOutside: updateDailyOrdersOutside,
    romaneioStartTime,
    setRomaneioStartTime: updateRomaneioStartTime,
    romaneioEndTime,
    setRomaneioEndTime: updateRomaneioEndTime,
    selectedDate,
    setSelectedDate,
    separators,
    addSeparator,
    removeSeparator,
    updateOrderSeparator,
    addCollaborators,
    removeCollaborator,
  };
};
