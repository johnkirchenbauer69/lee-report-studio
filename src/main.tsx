import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { BenchmarkPage } from './renderers/browser/BenchmarkPage';
import './styles/app.css';
import './styles/advanced.css';

const params = new URLSearchParams(window.location.search);
const benchmark = params.get('benchmark') === '1';
const content = benchmark ? <BenchmarkPage pageIndex={Number(params.get('page')??0)}/> : <App/>;
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{content}</React.StrictMode>);
