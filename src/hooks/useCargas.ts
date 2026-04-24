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
  serverTimestamp,
  Timestamp,
  writeBatch
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';

export interface PedidoCarga {
  id: string;
  cargaId: string;
  numeroOrdem: number;
  separador: string;
  horaRegistro: Date;
}

export interface Carga {
  id: string;
  motorista: string;
  quantidadePedidos: number;
  status: 'aberta' | 'finalizada';
  data: string;
  horaFim: Date | null;
  pedidos: PedidoCarga[];
}

export const useCargas = (selectedDate: string) => {
  const [cargas, setCargas] = useState<Carga[]>([]);
  const { isAuthenticated, user } = useAuth();

  useEffect(() => {
    const q = query(
      collection(db, 'cargas'),
      where('data', '==', selectedDate),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const cargasData = await Promise.all(
        snapshot.docs.map(async (cargaDoc) => {
          const data = cargaDoc.data();
          
          // Buscar pedidos da carga (subcoleção)
          const pedidosSnap = await getDocs(
            query(collection(db, `cargas/${cargaDoc.id}/pedidos`), orderBy('numero_ordem', 'asc'))
          );
          
          const pedidos = pedidosSnap.docs.map(pDoc => {
            const pData = pDoc.data();
            return {
              id: pDoc.id,
              cargaId: cargaDoc.id,
              numeroOrdem: pData.numero_ordem,
              separador: pData.separador,
              horaRegistro: (pData.hora_registro as Timestamp).toDate(),
            };
          });

          return {
            id: cargaDoc.id,
            motorista: data.motorista,
            quantidadePedidos: data.quantidade_pedidos,
            status: data.status,
            data: data.data,
            horaFim: data.hora_fim ? (data.hora_fim as Timestamp).toDate() : null,
            pedidos,
          } as Carga;
        })
      );

      setCargas(cargasData);
    });

    return () => unsubscribe();
  }, [selectedDate]);

  const addCarga = async (motorista: string, quantidadePedidos: number) => {
    if (!isAuthenticated) return { success: false, error: 'Não autenticado' };
    if (!motorista.trim()) return { success: false, error: 'Informe o motorista' };
    if (quantidadePedidos < 1) return { success: false, error: 'Quantidade inválida' };

    try {
      await addDoc(collection(db, 'cargas'), {
        motorista: motorista.trim(),
        quantidade_pedidos: quantidadePedidos,
        status: 'aberta',
        data: selectedDate,
        createdAt: serverTimestamp(),
        createdBy: user?.uid
      });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  };

  const removeCarga = async (cargaId: string) => {
    if (!isAuthenticated) return false;
    try {
      await deleteDoc(doc(db, 'cargas', cargaId));
      return true;
    } catch (error) {
      return false;
    }
  };

  const finishCarga = async (cargaId: string) => {
    if (!isAuthenticated) return false;
    try {
      await updateDoc(doc(db, 'cargas', cargaId), { 
        status: 'finalizada', 
        hora_fim: serverTimestamp() 
      });
      return true;
    } catch (error) {
      return false;
    }
  };

  const reopenCarga = async (cargaId: string) => {
    if (!isAuthenticated) return false;
    try {
      await updateDoc(doc(db, 'cargas', cargaId), { 
        status: 'aberta', 
        hora_fim: null 
      });
      return true;
    } catch (error) {
      return false;
    }
  };

  const addPedido = async (cargaId: string, separador: string, numeroOrdem?: number) => {
    if (!isAuthenticated) return { success: false, error: 'Não autenticado' };

    const carga = cargas.find((c) => c.id === cargaId);
    if (!carga) return { success: false, error: 'Carga não encontrada' };
    if (carga.status === 'finalizada') return { success: false, error: 'Carga já finalizada' };
    if (carga.pedidos.length >= carga.quantidadePedidos) {
      return { success: false, error: 'Quantidade máxima de pedidos atingida' };
    }

    const ocupados = new Set(carga.pedidos.map((p) => p.numeroOrdem));
    let numero = numeroOrdem ?? 0;
    if (!numero) {
      for (let i = 1; i <= carga.quantidadePedidos; i++) {
        if (!ocupados.has(i)) { numero = i; break; }
      }
    }

    if (!numero || numero < 1 || numero > carga.quantidadePedidos) {
      return { success: false, error: 'Número de pedido inválido' };
    }
    if (ocupados.has(numero)) {
      return { success: false, error: `Pedido nº ${numero} já registrado` };
    }

    try {
      const batch = writeBatch(db);
      const pedidoRef = doc(collection(db, `cargas/${cargaId}/pedidos`));
      
      batch.set(pedidoRef, {
        numero_ordem: numero,
        separador,
        hora_registro: serverTimestamp(),
      });

      // Auto finaliza a carga se atingiu o total
      if (carga.pedidos.length + 1 === carga.quantidadePedidos) {
        const cargaRef = doc(db, 'cargas', cargaId);
        batch.update(cargaRef, { 
          status: 'finalizada', 
          hora_fim: serverTimestamp() 
        });
      }

      await batch.commit();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  };

  const updatePedidoSeparador = async (pedidoId: string, novoSeparador: string, cargaId: string) => {
    if (!isAuthenticated) return false;
    try {
      await updateDoc(doc(db, `cargas/${cargaId}/pedidos`, pedidoId), { 
        separador: novoSeparador 
      });
      return true;
    } catch (error) {
      return false;
    }
  };

  const removePedido = async (pedidoId: string, cargaId: string) => {
    if (!isAuthenticated) return false;
    try {
      await deleteDoc(doc(db, `cargas/${cargaId}/pedidos`, pedidoId));
      return true;
    } catch (error) {
      return false;
    }
  };

  return {
    cargas,
    addCarga,
    removeCarga,
    finishCarga,
    reopenCarga,
    addPedido,
    updatePedidoSeparador: (pedidoId: string, novoSeparador: string, cargaId: string) => 
      updatePedidoSeparador(pedidoId, novoSeparador, cargaId),
    removePedido: (pedidoId: string, cargaId: string) => 
      removePedido(pedidoId, cargaId),
  };
};
