import { Controller } from '@hotwired/stimulus';
import styles from '../styles/card.module.scss';

export default class extends Controller {
    connect() {
        this.element.classList.add(styles.badge);
    }
}
