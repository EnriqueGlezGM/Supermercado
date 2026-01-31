import { useEffect } from 'react';
import './App.css';
import { initTicketApp } from './ticketApp';

export default function App() {
  useEffect(() => {
    initTicketApp();
  }, []);

  return (
    <>
      <div className="app-shell container py-4 pb-5">
        <header className="glass-header text-center mb-4">
          <div className="store-logos">
            <img
              src="https://www.freelogovectors.net/wp-content/uploads/2023/10/mercadonalogo-freelogovectors.net_.png"
              alt="Mercadona"
              className="store-logo mercadona-logo"
            />
            <img
              src="https://upload.wikimedia.org/wikipedia/commons/9/91/Lidl-Logo.svg"
              alt="Lidl"
              className="store-logo lidl-logo"
            />
          </div>
          <p className="glass-title mb-0 mt-3">Lector de tickets</p>
          <small id="progress" className="text-muted d-block mt-2"></small>
        </header>

        <input
          id="file"
          type="file"
          accept="application/pdf,image/*"
          className="form-control my-2"
        />

        <div id="meta" className="small text-muted"></div>
        <div id="check" className="mb-2"></div>

        <div className="table-wrap card shadow-sm">
          <table className="table table-sm align-middle mb-0" id="tbl">
            <thead>
              <tr>
                <th style={{ width: '120px' }}>Nº</th>
                <th className="th-desc">
                  Producto
                  <button
                    id="btnSort"
                    type="button"
                    className="btn btn-sm btn-outline-secondary ms-2 py-0"
                    title="Cambiar orden"
                  >
                    A→Z
                  </button>
                </th>
                <th style={{ width: '180px' }}></th>
                <th className="text-end" style={{ width: '140px' }}>
                  Importe (€)
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={4} className="text-muted">
                  Selecciona un PDF o imagen…
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div id="catsum" className="mt-2"></div>

        <div className="d-grid mt-2">
          <button id="btnExport" className="btn btn-outline-secondary" disabled>
            Exportar resumen
          </button>
        </div>

        <div id="manualFix" className="card mt-3 d-none">
          <div className="card-body">
            <div id="diffMsg" className="mb-2 small"></div>
            <form id="manualForm" className="row g-2 align-items-end">
              <div className="col-12 col-sm-6">
                <label className="form-label small mb-1">Producto</label>
                <input
                  id="mfDesc"
                  type="text"
                  className="form-control"
                  placeholder="Ej. línea faltante"
                />
              </div>
              <div className="col-6 col-sm-3">
                <label className="form-label small mb-1">Importe</label>
                <div className="input-group">
                  <span className="input-group-text">€</span>
                  <input
                    id="mfAmount"
                    type="text"
                    className="form-control mono"
                    defaultValue="0,00"
                    inputMode="decimal"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div className="col-6 col-sm-3">
                <label className="form-label small mb-1">Categoría</label>
                <div id="mfCatWrap" className="dropdown w-100"></div>
                <input id="mfCatVal" type="hidden" defaultValue="" />
              </div>
              <div className="col-12">
                <button id="btnAddManual" className="btn btn-sm btn-warning">
                  Añadir línea
                </button>
              </div>
            </form>
          </div>
        </div>

        <div id="export-root" style={{ position: 'fixed', left: '-200vw', top: 0 }}></div>
        <div id="nav-spacer" aria-hidden="true"></div>
      </div>

      <nav className="glass-nav fixed-bottom">
        <div className="container">
          <div className="glass-nav-dock">
            <div className="catbar-scroll">
              <div className="catbar" id="catBar"></div>
            </div>
            <button id="catAddBtn" className="glass-fab" type="button" aria-label="Nueva categoría">
              <span aria-hidden="true">+</span>
            </button>
          </div>
        </div>
      </nav>

      <div className="modal fade" id="catEditModal" tabIndex={-1} aria-labelledby="catEditLabel" aria-hidden="true">
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title" id="catEditLabel">Categoría</h5>
              <button type="button" className="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
            </div>
            <div className="modal-body">
              <form id="catEditForm" className="row g-3">
                <div className="col-8">
                  <label htmlFor="catEditName" className="form-label small mb-1">Nombre</label>
                  <input type="text" id="catEditName" className="form-control" maxLength={40} required />
                </div>
                <div className="col-4">
                  <label htmlFor="catEditColor" className="form-label small mb-1">Color</label>
                  <input
                    type="color"
                    id="catEditColor"
                    className="form-control form-control-color"
                    defaultValue="#22c55e"
                    title="Elige color"
                  />
                </div>
              </form>
              <div id="catEditHint" className="form-text">Pulsa “Guardar” para aplicar los cambios.</div>
            </div>
            <div className="modal-footer justify-content-between">
              <button type="button" id="catEditDelete" className="btn btn-outline-danger d-none">Eliminar</button>
              <div className="d-flex gap-2">
                <button type="button" className="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>
                <button type="button" id="catEditSave" className="btn btn-primary">Guardar</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="modal fade" id="splitModal" tabIndex={-1} aria-labelledby="splitLabel" aria-hidden="true">
        <div className="modal-dialog modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title" id="splitLabel">Repartir por porcentaje</h5>
              <button type="button" className="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
            </div>
            <div className="modal-body">
              <div id="splitItemMeta" className="small text-muted"></div>
              <div id="splitList" className="split-list mt-2"></div>
              <div className="d-flex align-items-center justify-content-between mt-2">
                <div className="small">Total: <strong id="splitTotal">0%</strong></div>
                <div className="small text-danger d-none" id="splitWarn">El total debe ser 100%.</div>
              </div>
            </div>
            <div className="modal-footer justify-content-between">
              <button type="button" id="splitClear" className="btn btn-outline-danger">Quitar asignación</button>
              <div className="d-flex gap-2">
                <button type="button" className="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>
                <button type="button" id="splitSave" className="btn btn-primary">Guardar</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
