import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface TradeFinanceData {
  id: string;
  name: string;
  encryptedValue: number;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
  riskLevel: string;
  status: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [tradeData, setTradeData] = useState<TradeFinanceData[]>([]);
  const [filteredData, setFilteredData] = useState<TradeFinanceData[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingTrade, setCreatingTrade] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newTradeData, setNewTradeData] = useState({ 
    name: "", 
    amount: "", 
    riskScore: "",
    description: "" 
  });
  const [selectedTrade, setSelectedTrade] = useState<TradeFinanceData | null>(null);
  const [stats, setStats] = useState({
    totalApplications: 0,
    verifiedApplications: 0,
    totalAmount: 0,
    avgRiskScore: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevm = async () => {
      if (isConnected && !isInitialized) {
        try {
          await initialize();
        } catch (error) {
          console.error('FHEVM initialization failed:', error);
        }
      }
    };
    initFhevm();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadData = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      try {
        const contract = await getContractReadOnly();
        if (!contract) return;
        
        const businessIds = await contract.getAllBusinessIds();
        const tradeList: TradeFinanceData[] = [];
        
        for (const businessId of businessIds) {
          try {
            const data = await contract.getBusinessData(businessId);
            tradeList.push({
              id: businessId,
              name: data.name,
              encryptedValue: 0,
              publicValue1: Number(data.publicValue1),
              publicValue2: Number(data.publicValue2),
              description: data.description,
              creator: data.creator,
              timestamp: Number(data.timestamp),
              isVerified: data.isVerified,
              decryptedValue: Number(data.decryptedValue),
              riskLevel: calculateRiskLevel(Number(data.publicValue1)),
              status: data.isVerified ? "Verified" : "Pending"
            });
          } catch (e) {
            console.error('Error loading trade data:', e);
          }
        }
        
        setTradeData(tradeList);
        setFilteredData(tradeList);
        updateStats(tradeList);
      } catch (e) {
        console.error('Failed to load data:', e);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isConnected]);

  useEffect(() => {
    let filtered = tradeData;
    if (searchTerm) {
      filtered = filtered.filter(item => 
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.description.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    if (statusFilter !== "all") {
      filtered = filtered.filter(item => item.status === statusFilter);
    }
    setFilteredData(filtered);
  }, [searchTerm, statusFilter, tradeData]);

  const updateStats = (data: TradeFinanceData[]) => {
    const total = data.length;
    const verified = data.filter(item => item.isVerified).length;
    const totalAmount = data.reduce((sum, item) => sum + item.publicValue1, 0);
    const avgRisk = data.length > 0 ? data.reduce((sum, item) => sum + item.publicValue2, 0) / data.length : 0;
    
    setStats({
      totalApplications: total,
      verifiedApplications: verified,
      totalAmount,
      avgRiskScore: avgRisk
    });
  };

  const calculateRiskLevel = (score: number): string => {
    if (score >= 8) return "Low";
    if (score >= 6) return "Medium";
    return "High";
  };

  const createTrade = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingTrade(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating trade application with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Contract not available");
      
      const amountValue = parseInt(newTradeData.amount) || 0;
      const businessId = `trade-${Date.now()}`;
      
      const encryptedResult = await encrypt(await contract.getAddress(), address, amountValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newTradeData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newTradeData.riskScore) || 5,
        0,
        newTradeData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Trade application created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewTradeData({ name: "", amount: "", riskScore: "", description: "" });
        window.location.reload();
      }, 2000);
      
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected") ? "Transaction rejected" : "Creation failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingTrade(false); 
    }
  };

  const decryptData = async (businessId: string) => {
    if (!isConnected) return;
    
    try {
      const contractRead = await getContractReadOnly();
      const contractWrite = await getContractWithSigner();
      if (!contractRead || !contractWrite) return;
      
      const data = await contractRead.getBusinessData(businessId);
      if (data.isVerified) {
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return;
      }
      
      const encryptedValue = await contractRead.getEncryptedValue(businessId);
      
      await verifyDecryption(
        [encryptedValue],
        await contractRead.getAddress(),
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        window.location.reload();
      }, 2000);
      
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (contract) {
        const available = await contract.isAvailable();
        if (available) {
          setTransactionStatus({ visible: true, status: "success", message: "Contract is available and working!" });
          setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        }
      }
    } catch (e) {
      console.error('Availability check failed:', e);
    }
  };

  const renderStatsPanel = () => (
    <div className="stats-panel">
      <div className="stat-item metal-card">
        <div className="stat-icon">📊</div>
        <div className="stat-content">
          <div className="stat-value">{stats.totalApplications}</div>
          <div className="stat-label">Total Applications</div>
        </div>
      </div>
      <div className="stat-item metal-card">
        <div className="stat-icon">✅</div>
        <div className="stat-content">
          <div className="stat-value">{stats.verifiedApplications}</div>
          <div className="stat-label">Verified</div>
        </div>
      </div>
      <div className="stat-item metal-card">
        <div className="stat-icon">💰</div>
        <div className="stat-content">
          <div className="stat-value">${stats.totalAmount.toLocaleString()}</div>
          <div className="stat-label">Total Amount</div>
        </div>
      </div>
      <div className="stat-item metal-card">
        <div className="stat-icon">⚡</div>
        <div className="stat-content">
          <div className="stat-value">{stats.avgRiskScore.toFixed(1)}</div>
          <div className="stat-label">Avg Risk Score</div>
        </div>
      </div>
    </div>
  );

  const renderRiskChart = (riskScore: number) => {
    const percentage = (riskScore / 10) * 100;
    return (
      <div className="risk-chart">
        <div className="chart-container">
          <div 
            className={`chart-fill ${riskScore >= 8 ? 'low-risk' : riskScore >= 6 ? 'medium-risk' : 'high-risk'}`}
            style={{ width: `${percentage}%` }}
          >
            <span className="chart-value">{riskScore}/10</span>
          </div>
        </div>
        <div className="chart-labels">
          <span>High Risk</span>
          <span>Medium</span>
          <span>Low Risk</span>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container metal-theme">
        <header className="app-header">
          <div className="logo-section">
            <h1 className="logo">🔐 FHE Trade Finance</h1>
            <p className="tagline">Confidential Trade Finance Platform</p>
          </div>
          <ConnectButton />
        </header>
        <div className="connection-prompt">
          <div className="metal-welcome">
            <h2>Secure Trade Finance with FHE</h2>
            <p>Connect your wallet to access encrypted trade financing</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="loading-screen metal-theme">
        <div className="metal-spinner"></div>
        <p>Initializing FHE Security System...</p>
      </div>
    );
  }

  return (
    <div className="app-container metal-theme">
      <header className="app-header">
        <div className="logo-section">
          <h1 className="logo">🔐 FHE Trade Finance</h1>
          <p className="tagline">Metal-Secured Confidential Trading</p>
        </div>
        <div className="header-actions">
          <button className="metal-btn primary" onClick={testAvailability}>
            Test Contract
          </button>
          <ConnectButton />
        </div>
      </header>

      <div className="main-content">
        <div className="control-panel metal-panel">
          <div className="search-section">
            <input
              type="text"
              placeholder="Search applications..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="metal-input"
            />
            <select 
              value={statusFilter} 
              onChange={(e) => setStatusFilter(e.target.value)}
              className="metal-select"
            >
              <option value="all">All Status</option>
              <option value="Verified">Verified</option>
              <option value="Pending">Pending</option>
            </select>
            <button 
              onClick={() => setShowCreateModal(true)}
              className="metal-btn accent"
            >
              + New Application
            </button>
          </div>
        </div>

        <div className="content-panels">
          <div className="left-panel">
            {renderStatsPanel()}
            <div className="applications-list metal-panel">
              <h3>Trade Applications ({filteredData.length})</h3>
              <div className="list-container">
                {filteredData.map((item) => (
                  <div 
                    key={item.id}
                    className={`application-item metal-card ${selectedTrade?.id === item.id ? 'selected' : ''}`}
                    onClick={() => setSelectedTrade(item)}
                  >
                    <div className="app-header">
                      <span className="app-name">{item.name}</span>
                      <span className={`status-badge ${item.status.toLowerCase()}`}>
                        {item.status}
                      </span>
                    </div>
                    <div className="app-details">
                      <span>Amount: ${item.publicValue1.toLocaleString()}</span>
                      <span>Risk: {item.riskLevel}</span>
                    </div>
                    <div className="app-meta">
                      {new Date(item.timestamp * 1000).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="right-panel">
            {selectedTrade ? (
              <div className="detail-panel metal-panel">
                <h3>Application Details</h3>
                <div className="detail-section">
                  <div className="detail-row">
                    <span>Application Name:</span>
                    <strong>{selectedTrade.name}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Financing Amount:</span>
                    <strong>${selectedTrade.publicValue1.toLocaleString()}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Risk Score:</span>
                    <strong>{selectedTrade.publicValue2}/10</strong>
                  </div>
                  <div className="detail-row">
                    <span>Risk Level:</span>
                    <strong className={`risk-level ${selectedTrade.riskLevel.toLowerCase()}`}>
                      {selectedTrade.riskLevel}
                    </strong>
                  </div>
                  <div className="detail-row">
                    <span>Status:</span>
                    <strong className={`status ${selectedTrade.status.toLowerCase()}`}>
                      {selectedTrade.status}
                    </strong>
                  </div>
                </div>

                <div className="chart-section">
                  <h4>Risk Assessment</h4>
                  {renderRiskChart(selectedTrade.publicValue2)}
                </div>

                <div className="fhe-section">
                  <h4>FHE Security</h4>
                  <div className="fhe-status">
                    <div className="fhe-indicator">
                      <span className={`indicator-dot ${selectedTrade.isVerified ? 'verified' : 'encrypted'}`}></span>
                      {selectedTrade.isVerified ? 'On-chain Verified' : 'FHE Encrypted'}
                    </div>
                    {selectedTrade.isVerified ? (
                      <div className="decrypted-value">
                        Decrypted Amount: ${selectedTrade.decryptedValue.toLocaleString()}
                      </div>
                    ) : (
                      <button 
                        onClick={() => decryptData(selectedTrade.id)}
                        className="metal-btn primary"
                        disabled={fheIsDecrypting}
                      >
                        {fheIsDecrypting ? 'Decrypting...' : 'Verify Decryption'}
                      </button>
                    )}
                  </div>
                </div>

                <div className="description-section">
                  <h4>Description</h4>
                  <p>{selectedTrade.description}</p>
                </div>
              </div>
            ) : (
              <div className="placeholder-panel metal-panel">
                <div className="placeholder-content">
                  <div className="placeholder-icon">📋</div>
                  <h3>Select an Application</h3>
                  <p>Choose a trade finance application from the list to view details and perform FHE operations</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal metal-panel">
            <div className="modal-header">
              <h3>New Trade Finance Application</h3>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Application Name</label>
                <input
                  type="text"
                  value={newTradeData.name}
                  onChange={(e) => setNewTradeData({...newTradeData, name: e.target.value})}
                  className="metal-input"
                  placeholder="Enter application name"
                />
              </div>
              <div className="form-group">
                <label>Financing Amount (FHE Encrypted)</label>
                <input
                  type="number"
                  value={newTradeData.amount}
                  onChange={(e) => setNewTradeData({...newTradeData, amount: e.target.value})}
                  className="metal-input"
                  placeholder="Enter amount in USD"
                />
                <small>This value will be encrypted using FHE technology</small>
              </div>
              <div className="form-group">
                <label>Risk Score (1-10)</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={newTradeData.riskScore}
                  onChange={(e) => setNewTradeData({...newTradeData, riskScore: e.target.value})}
                  className="metal-input"
                  placeholder="Enter risk score"
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={newTradeData.description}
                  onChange={(e) => setNewTradeData({...newTradeData, description: e.target.value})}
                  className="metal-textarea"
                  placeholder="Enter application description"
                  rows={3}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button 
                onClick={() => setShowCreateModal(false)}
                className="metal-btn secondary"
              >
                Cancel
              </button>
              <button 
                onClick={createTrade}
                disabled={creatingTrade || isEncrypting || !newTradeData.name || !newTradeData.amount}
                className="metal-btn primary"
              >
                {creatingTrade || isEncrypting ? 'Creating...' : 'Create Application'}
              </button>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            <span className="notification-message">{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;


