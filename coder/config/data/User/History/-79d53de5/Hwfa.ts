import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('Technicians')
export class Technicians {
    @PrimaryGeneratedColumn('increment')
    TechnicianID: number;

    @Column({ type: 'varchar', length: 55 })
    Username: string;

    @Column({ type: 'varchar', length: 55 })
    FirstName: string;

    @Column({ type: 'varchar', length: 55 })
    LastName: string;
}
