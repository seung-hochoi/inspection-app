// Final working implementation of App.js

import React from 'react';
import { View, Text, Button, StyleSheet, ScrollView } from 'react-native';

// Sample component for collapsible sections
const CollapsibleSection = ({ title, children }) => {
    const [isOpen, setIsOpen] = React.useState(false);
    return (
        <View>
            <Button title={title} onPress={() => setIsOpen(!isOpen)} />
            {isOpen && <View>{children}</View>}
        </View>
    );
};

const App = () => {
    return (
        <ScrollView style={styles.container}>
            <Text style={styles.header}>Inspection App</Text>
            {/* Collapsible sections for partner groups */}
            <CollapsibleSection title="Partner Group 1">
                <View style={styles.row}><Text>Product 1: Order Quantity: 5 | Inspection Quantity: 4</Text></View>
                <View style={styles.row}><Text>Product 2: Order Quantity: 3 | Inspection Quantity: 3</Text></View>
            </CollapsibleSection>
            <CollapsibleSection title="Partner Group 2">
                <View style={styles.row}><Text>Product 3: Order Quantity: 2 | Inspection Quantity: 2</Text></View>
            </CollapsibleSection>
            <Button title="Capture Photo" onPress={() => { /* logic to capture photo */ }} />
            <Button title="Batch Save" onPress={() => { /* logic to save batch */ }} />
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#121212', // Dark theme background
        padding: 16,
    },
    header: {
        fontSize: 24,
        color: '#ffffff', // Dark theme text color
        fontWeight: 'bold',
    },
    row: {
        marginVertical: 8,
        padding: 12,
        backgroundColor: '#1e1e1e', // Dark theme row color
        borderRadius: 5,
    },
});

export default App;